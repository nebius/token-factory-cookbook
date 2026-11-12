"""Quality gates and selection: which teacher trajectories become training examples.

Input: trajectory files written by collect.py. Output: the chosen trajectory paths, one per line.
Usage: python select_sft.py trajectories/ --exclude-repos eval_repos.txt --out selected.txt
"""
from __future__ import annotations

import argparse
import collections
import json
import random
import re
from pathlib import Path

from agent import TOOLS

TOOL_NAMES = {t['function']['name'] for t in TOOLS}
PROTECTED = re.compile(r'(^|/)(tests?|testing)/.*\.py$|(^|/)test_[^/]*\.py$|_test\.py$'
                       r'|(^|/)(conftest\.py|pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|sitecustomize\.py)$')
SCRATCH = re.compile(r'(^|/)(repro|reproduce|debug|scratch|tmp|check|verify)[^/]*\.py$', re.I)


def calls(traj):
    """(name, arguments, result) for every tool call, in order."""
    results = {m['tool_call_id']: json.loads(m['content']) for m in traj['messages'] if m['role'] == 'tool'}
    for m in traj['messages']:
        for c in m.get('tool_calls') or []:
            yield c['function']['name'], c['function']['arguments'], results.get(c['id'], {})


def tag(name, arguments):
    if name in ('edit_file', 'write_file'):
        return 'edit'
    if name != 'run_command':
        return name
    command = json.loads(arguments or '{}').get('command', '')
    if re.search(r'\bpytest\b|unittest|tox\b|nox\b', command):
        return 'test'
    return 'python' if re.search(r'\bpython3?\b', command) else 'other'


def retested(traj):
    """Ran a test or a Python check after its last edit."""
    tags = [tag(n, a) for n, a, _ in calls(traj)]
    edits = [i for i, t in enumerate(tags) if t == 'edit']
    return bool(edits) and any(t in ('test', 'python') for t in tags[edits[-1] + 1:])


def gate(traj, eval_repos, max_calls=28):
    """The first gate this trajectory fails, or None. The length gate is applied in render.py."""
    cs = list(calls(traj))
    files = re.findall(r'^\+\+\+ b/(\S+)', traj['patch'], flags=re.M)
    repeats = sum(a[:2] == b[:2] for a, b in zip(cs, cs[1:]))
    errors = sum(r.get('status') == 'error' for *_, r in cs)
    if not traj['resolved']:
        return 'resolved'
    if any(n not in TOOL_NAMES for n, *_ in cs):
        return 'tools'
    if traj['tool_calls'] > max_calls:
        return 'budget'
    if not traj['patch'].strip() or any(PROTECTED.search(f) or SCRATCH.search(f) for f in files):
        return 'patch'
    if cs and (errors / len(cs) > 0.25 or repeats > 3):
        return 'errors'
    if traj['repo'].lower() in eval_repos:
        return 'leak'
    return None


def select(trajs, max_tasks=40, max_examples=50, small_repo=10, seed=0):
    """One primary trajectory per task (best habits first); a second one, from the other teacher, only for hard tasks
    and small repositories. Caps per repository: max_tasks tasks and max_examples examples."""
    by_task = collections.defaultdict(list)
    attempts = collections.defaultdict(list)
    for t in trajs:
        attempts[t['instance_id']].append(t['resolved'])
        if t['passed_gates']:
            by_task[t['instance_id']].append(t)
    hard = {i for i, r in attempts.items() if not all(r)}         # some teacher attempt failed
    best_first = lambda t: (not retested(t), t['tool_calls'], t['n_tokens'])
    by_repo = collections.defaultdict(list)
    for task, cands in by_task.items():
        cands.sort(key=best_first)
        by_repo[cands[0]['repo']].append(task)
    rng, chosen = random.Random(seed), []
    for repo, tasks in by_repo.items():
        rng.shuffle(tasks)
        tasks.sort(key=lambda i: i not in hard)                     # hard tasks survive the cap first
        tasks = tasks[:max_tasks]
        picked = [by_task[i][0] for i in tasks]
        for i in tasks:
            other = [t for t in by_task[i][1:] if t['model'] != by_task[i][0]['model']]
            if other and (len(tasks) <= small_repo or i in hard) and len(picked) < max_examples:
                picked.append(other[0])
        chosen += picked
    return chosen


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('trajectories')
    ap.add_argument('--exclude-repos', help='file with one evaluation repository per line (owner/name)')
    ap.add_argument('--tokens', help='render.py --count output: path -> rendered token count')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    eval_repos = set()
    if args.exclude_repos:
        eval_repos = {l.strip().lower() for l in Path(args.exclude_repos).read_text().splitlines() if l.strip()}
    n_tokens = json.loads(Path(args.tokens).read_text()) if args.tokens else {}
    trajs, failed = [], collections.Counter()
    for p in sorted(Path(args.trajectories).rglob('*.json')):
        t = json.loads(p.read_text())
        reason = gate(t, eval_repos)
        if reason is None and n_tokens and n_tokens.get(str(p)) is None:
            reason = 'length'                                        # cut before its last edit at the length cap
        failed[reason] += 1
        trajs.append(dict(t, path=str(p), passed_gates=reason is None, n_tokens=n_tokens.get(str(p), 0)))
    chosen = select(trajs)
    Path(args.out).write_text(''.join(t['path'] + '\n' for t in chosen))
    print('gates:', dict(failed), '| selected', len(chosen), 'trajectories over',
          len({t['instance_id'] for t in chosen}), 'tasks and', len({t['repo'] for t in chosen}), 'repos')


if __name__ == '__main__':
    main()
