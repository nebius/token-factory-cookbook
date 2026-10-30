"""Run the analyst task across reasoning-effort levels and seeds, then compare."""

from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from statistics import mean

from openai import APIError, OpenAI

from agent import BASE_URL, EFFORTS, MODEL, list_prices, play


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--efforts", nargs="+", choices=["default", *EFFORTS], default=["low", "medium", "high"])
    parser.add_argument("--seeds", nargs="+", type=int, default=[1, 2, 3, 4, 5])
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--out", default="sweep.jsonl")
    args = parser.parse_args()

    client = OpenAI(base_url=BASE_URL, api_key=os.environ["NEBIUS_API_KEY"], timeout=120)
    prices = list_prices(client, MODEL)
    jobs = [(effort, seed) for effort in args.efforts for seed in args.seeds]

    def run(job):
        effort, seed = job
        try:
            record = play(
                client,
                seed,
                effort=None if effort == "default" else effort,
                prices=prices,
                log=lambda line: None,
            )
        except APIError as error:
            print(f"{effort:>7}  seed {seed:<3} request failed: {error}")
            return None
        print(f"{effort:>7}  seed {seed:<3} {record['correct']} of 3 correct  {record['turns']:>2} turns  {record['seconds']:>6} s")
        return record

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        records = [record for record in pool.map(run, jobs) if record]

    with open(args.out, "w") as handle:
        for record in records:
            handle.write(json.dumps(record) + "\n")

    print("\n| Effort | All 3 correct | Correct answers | Turns | Completion tokens | Reasoning tokens | Seconds | Cost |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|")
    for effort in args.efforts:
        rows = [r for r in records if r["effort"] == effort]
        if not rows:
            continue
        perfect = sum(r["correct"] == 3 for r in rows)
        cost = mean(r["cost_usd"] for r in rows) if prices else float("nan")
        print(
            f"| {effort} | {perfect}/{len(rows)} | {mean(r['correct'] for r in rows):.1f} "
            f"| {mean(r['turns'] for r in rows):.1f} | {mean(r['completion_tokens'] for r in rows):,.0f} "
            f"| {mean(r['reasoning_tokens'] for r in rows):,.0f} | {mean(r['seconds'] for r in rows):.1f} | ${cost:.4f} |"
        )
    print(f"\nWrote {len(records)} runs to {args.out}")


if __name__ == "__main__":
    main()
