"""Collect teacher trajectories on Nebius Token Factory: every task with every teacher, many tasks in parallel.

Usage: NEBIUS_API_KEY=... python collect.py tasks.jsonl trajectories/ --workers 32
tasks.jsonl holds validated tasks (tasks.validate) whose repositories are not in any evaluation set.
Re-running skips finished attempts, so an interrupted collection simply resumes.
"""
from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import openai

from agent import Limits, run_agent
from tasks import Sandbox, run_tests

TEACHERS = ['moonshotai/Kimi-K3', 'deepseek-ai/DeepSeek-V4.1-Flash-1017']
SAMPLING = dict(temperature=1.0, top_p=0.95, max_tokens=8192)
LIMITS = Limits(tool_calls=28, minutes=16)   # the student's call limit; twice its time, to absorb API latency


def token_factory() -> openai.OpenAI:
    return openai.OpenAI(base_url='https://api.tokenfactory.nebius.com/v1', api_key=os.environ['NEBIUS_API_KEY'],
                         max_retries=8)      # retries rate limits, 5xx and dropped connections with back-off


def attempt(client: openai.OpenAI, task: dict, model: str, out_dir: Path) -> dict | None:
    path = out_dir / model.replace('/', '__') / f'{task["instance_id"]}.json'
    if path.exists():
        return None
    box = Sandbox(task['image'])
    try:
        traj = run_agent(client, model, task, box, LIMITS, SAMPLING)
    finally:
        box.close()
    traj['resolved'] = run_tests(task, traj['patch'])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(traj))
    return traj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tasks')
    ap.add_argument('out_dir', type=Path)
    ap.add_argument('--teachers', nargs='+', default=TEACHERS)
    ap.add_argument('--workers', type=int, default=32, help='parallel tasks; each runs its own container')
    args = ap.parse_args()
    if not os.environ.get('NEBIUS_API_KEY'):
        ap.error('set NEBIUS_API_KEY, for example: uv run --env-file .env python collect.py ...')
    client = token_factory()
    tasks = [json.loads(l) for l in open(args.tasks)]
    jobs = [(t, m) for m in args.teachers for t in tasks]
    totals = {m: dict(attempts=0, resolved=0, prompt_tokens=0, cached_tokens=0, completion_tokens=0)
              for m in args.teachers}
    with ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(attempt, client, t, m, args.out_dir): (t['instance_id'], m) for t, m in jobs}
        for f in as_completed(futures):
            try:
                traj = f.result()
            except Exception as e:                  # failed after retries: re-run later to retry it
                print('failed', futures[f], repr(e)[:200])
                continue
            if traj:
                s = totals[traj['model']]
                s['attempts'] += 1
                s['resolved'] += traj['resolved']
                for k, v in traj['usage'].items():
                    s[k] += v
    for m, s in totals.items():
        print(m, s)


if __name__ == '__main__':
    main()
