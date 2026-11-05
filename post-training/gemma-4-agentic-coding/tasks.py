"""Tasks with tests: SWE-rebench records, one Docker sandbox per task, and the solved/not-solved check.

SWE-rebench ships a prebuilt image per task in the SWE-bench layout: the repository is checked out at the base commit
in /testbed, and its dependencies live in the conda environment `testbed`.

Usage: python tasks.py --exclude-repos heldout_repos.txt --per-repo 3 --limit 100 --out tasks.jsonl
       python tasks.py --repos heldout_repos.txt --per-repo 10 --out heldout.jsonl
"""
from __future__ import annotations

import argparse
import collections
import json
import random
import re
import shlex
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ENV = 'source /opt/miniconda3/bin/activate testbed 2>/dev/null; '


def load_tasks(name: str = 'nebius/SWE-rebench', split: str = 'filtered') -> list[dict]:
    from datasets import load_dataset
    tasks = []
    for row in load_dataset(name, split=split):
        tasks.append(dict(
            instance_id=row['instance_id'], repo=row['repo'], base_commit=row['base_commit'],
            problem_statement=row['problem_statement'], gold_patch=row['patch'], test_patch=row['test_patch'],
            fail_to_pass=list(row['FAIL_TO_PASS']), pass_to_pass=list(row['PASS_TO_PASS']),
            test_cmd=row['install_config']['test_cmd'], image=row['image_name']))
    return tasks


class Sandbox:
    """A running container for one task. The agent sees the repository as /workspace."""

    def __init__(self, image: str):
        self.name = f'task-{uuid.uuid4().hex[:12]}'
        subprocess.run(['docker', 'run', '-d', '--rm', '--network', 'none', '--name', self.name, image,
                        'sleep', 'infinity'], check=True, capture_output=True)
        self.exec('ln -sfn /testbed /workspace', cwd='/')

    def exec(self, command: str, timeout: int = 300, cwd: str = '/workspace') -> tuple[int | None, str, str]:
        """Run a shell command; returns (exit_code, stdout, stderr), exit_code None on timeout."""
        argv = ['docker', 'exec', '-w', cwd, self.name, 'timeout', '-s', 'KILL', str(timeout),
                'bash', '-c', ENV + command]
        p = subprocess.run(argv, capture_output=True, text=True, errors='replace')
        return (None if p.returncode == 137 else p.returncode), p.stdout, p.stderr

    # files travel as bytes, so line endings survive a read-edit-write round trip
    def write(self, path: str, content: str) -> None:
        q = shlex.quote(path)
        subprocess.run(['docker', 'exec', '-i', self.name, 'bash', '-c', f'mkdir -p "$(dirname {q})" && cat > {q}'],
                       input=content.encode(), check=True, capture_output=True)

    def read(self, path: str) -> str:
        p = subprocess.run(['docker', 'exec', self.name, 'cat', path], capture_output=True)
        if p.returncode != 0:
            raise FileNotFoundError(path)
        return p.stdout.decode('utf-8', errors='replace')

    def diff(self) -> str:
        """The agent's patch: every change in the working tree, new files included."""
        return self.exec('git add -N . && git diff --binary HEAD')[1]

    def close(self) -> None:
        subprocess.run(['docker', 'rm', '-f', self.name], capture_output=True)


def changed_files(patch: str) -> list[str]:
    return re.findall(r'^diff --git a/(\S+) b/', patch, flags=re.M)


def parse_pytest(log: str) -> dict[str, str]:
    """Test id -> PASSED/FAILED/ERROR/SKIPPED, from the short summary that `pytest -rA` prints."""
    status = {}
    for line in log.splitlines():
        m = re.match(r'^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS) (\S+)', line)
        if m:
            status[m.group(2)] = m.group(1)
    return status


def run_tests(task: dict, patch: str, timeout: int = 600) -> bool:
    """Solved = the patch applies to a fresh checkout and every FAIL_TO_PASS and PASS_TO_PASS test passes."""
    box = Sandbox(task['image'])
    try:
        test_files = changed_files(task['test_patch'])
        if patch.strip():
            box.write('/tmp/model.diff', patch)
            if box.exec('git apply --whitespace=nowarn /tmp/model.diff')[0] != 0:
                return False
        # the model may not touch the tests: reset them, then add the task's tests
        box.exec(f'git checkout {task["base_commit"]} -- ' + ' '.join(test_files))
        box.write('/tmp/tests.diff', task['test_patch'])
        if box.exec('git apply /tmp/tests.diff')[0] != 0:
            return False
        code, out, err = box.exec(f'{task["test_cmd"]} {" ".join(test_files)}', timeout=timeout)
        status = parse_pytest(out)
        return all(status.get(t) == 'PASSED' for t in task['fail_to_pass'] + task['pass_to_pass'])
    finally:
        box.close()


def validate(task: dict) -> bool:
    """Keep a task only if the reference fix passes and an empty patch fails."""
    return run_tests(task, task['gold_patch']) and not run_tests(task, '')


def main():
    ap = argparse.ArgumentParser(description='Write validated SWE-rebench tasks to a JSONL file.')
    ap.add_argument('--out', required=True)
    ap.add_argument('--repos', help='keep only these repositories (file with one owner/name per line)')
    ap.add_argument('--exclude-repos', help='drop these repositories, e.g. the ones you hold out for evaluation')
    ap.add_argument('--per-repo', type=int, default=3, help='at most this many tasks per repository')
    ap.add_argument('--limit', type=int, default=0, help='validate at most this many tasks (0 = all)')
    ap.add_argument('--workers', type=int, default=8, help='tasks validated in parallel; each starts two containers')
    ap.add_argument('--seed', type=int, default=0)
    args = ap.parse_args()
    read = lambda f: {l.strip().lower() for l in Path(f).read_text().splitlines() if l.strip()}
    keep = read(args.repos) if args.repos else None
    drop = read(args.exclude_repos) if args.exclude_repos else set()
    tasks = [t for t in load_tasks() if t['repo'].lower() not in drop and (keep is None or t['repo'].lower() in keep)]
    random.Random(args.seed).shuffle(tasks)
    per_repo, picked = collections.Counter(), []
    for t in tasks:
        if per_repo[t['repo']] < args.per_repo:
            per_repo[t['repo']] += 1
            picked.append(t)
    picked = picked[:args.limit or None]

    def check(task):
        try:
            return validate(task)
        except Exception as e:                      # e.g. the image could not be pulled
            print('skipped', task['instance_id'], repr(e)[:200])
            return False

    n = 0
    with ThreadPoolExecutor(args.workers) as pool, open(args.out, 'w') as f:
        for task, ok in zip(picked, pool.map(check, picked)):
            if ok:
                f.write(json.dumps(task) + '\n')
                n += 1
    print(f'{n} of {len(picked)} tasks passed validation, written to {args.out}')


if __name__ == '__main__':
    main()
