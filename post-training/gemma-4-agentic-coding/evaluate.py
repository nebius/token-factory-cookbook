"""Evaluate Gemma 4, with or without the LoRA, on held-out tasks, and compare two runs task by task.

Serve first (4x L4, tensor parallel):
  vllm serve google/gemma-4-31B-it-qat-w4a16-ct --served-model-name gemma-4-31b --tensor-parallel-size 4 \
      --max-model-len 32768 --dtype bfloat16 --gpu-memory-utilization 0.90 \
      --enable-auto-tool-choice --tool-call-parser gemma4 --reasoning-parser gemma4 \
      --enable-lora --max-lora-rank 16 --lora-modules gemma-lora=runs/r16/epoch1

Usage: python evaluate.py heldout.jsonl --model gemma-4-31b --out base.jsonl     # base model
       python evaluate.py heldout.jsonl --model gemma-lora  --out lora.jsonl     # with the LoRA
       python evaluate.py --compare base.jsonl lora.jsonl
"""
from __future__ import annotations

import argparse
import json
import random

import openai

from agent import Limits, run_agent
from tasks import Sandbox, run_tests

SAMPLING = dict(temperature=1.0, top_p=0.95, max_tokens=8192,
                extra_body={'top_k': 64, 'chat_template_kwargs': {'enable_thinking': True}})


def evaluate(tasks_file, model, out, limits=Limits(), base_url='http://localhost:8000/v1'):
    client = openai.OpenAI(base_url=base_url, api_key='EMPTY')
    with open(out, 'w') as f:
        for line in open(tasks_file):                     # one task at a time, so timings are comparable
            task = json.loads(line)
            box = Sandbox(task['image'])
            try:
                traj = run_agent(client, model, task, box, limits, SAMPLING)
            finally:
                box.close()
            row = dict(instance_id=task['instance_id'], resolved=run_tests(task, traj['patch']),
                       **{k: traj[k] for k in ('tool_calls', 'model_calls', 'seconds', 'stop')})
            f.write(json.dumps(row) + '\n')
            print(row)


def compare(a_file, b_file, n=5000, seed=0):
    """Solved counts, then the change in total tool calls, model calls and time with a paired bootstrap 95% CI."""
    a = {r['instance_id']: r for r in map(json.loads, open(a_file))}
    b = {r['instance_id']: r for r in map(json.loads, open(b_file))}
    ids = sorted(a.keys() & b.keys())
    print(f'solved: {sum(a[i]["resolved"] for i in ids)}/{len(ids)} -> {sum(b[i]["resolved"] for i in ids)}/{len(ids)}; '
          f'gained {sum(b[i]["resolved"] and not a[i]["resolved"] for i in ids)}, '
          f'lost {sum(a[i]["resolved"] and not b[i]["resolved"] for i in ids)}')
    rng = random.Random(seed)
    for key in ('tool_calls', 'model_calls', 'seconds'):
        change = lambda s: sum(b[i][key] for i in s) / sum(a[i][key] for i in s) - 1
        boot = sorted(change([rng.choice(ids) for _ in ids]) for _ in range(n))
        print(f'{key:12} {change(ids):+.0%}  (95% CI {boot[int(0.025 * n)]:+.0%} to {boot[int(0.975 * n)]:+.0%})')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tasks', nargs='?')
    ap.add_argument('--model')
    ap.add_argument('--out')
    ap.add_argument('--compare', nargs=2)
    args = ap.parse_args()
    if args.compare:
        compare(*args.compare)
    else:
        evaluate(args.tasks, args.model, args.out)


if __name__ == '__main__':
    main()
