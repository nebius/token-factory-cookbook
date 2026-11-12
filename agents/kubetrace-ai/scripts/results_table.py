"""Print the experiment results table (Markdown) from the run database. Every finished attempt is
included; fixture, local live and Civo live runs are kept in separate sections.

  uv run python scripts/results_table.py [path/to/kubetrace.db]
"""
from __future__ import annotations

import json
import sqlite3
import statistics
import sys
from pathlib import Path

DB = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "artifacts" / "kubetrace.db"
TERMINAL = ("resolved", "escalated", "unresolved", "blocked", "cancelled", "error")
SECTIONS = [("civo-live", "Live on Civo"), ("local-live", "Live on local kind"), ("fixture", "Fixture runs (scripted test double, no model)")]


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(f"SELECT * FROM runs WHERE state IN ({','.join('?' * len(TERMINAL))}) ORDER BY created_at",
                        TERMINAL).fetchall()
    for prov, title in SECTIONS:
        group = [r for r in rows if r["provenance"] == prov]
        print(f"\n### {title}\n")
        if not group:
            print("No runs.\n")
            continue
        print("| Scenario | Model | Runs | First-attempt success | Eventual success | Outcomes | Median agent time | Median tokens |")
        print("|---|---|---|---|---|---|---|---|")
        by = {}
        for r in group:
            by.setdefault((r["scenario_id"], r["model"]), []).append(r)
        for (scenario, model), runs in sorted(by.items()):
            outcomes = {}
            for r in runs:
                outcomes[r["state"]] = outcomes.get(r["state"], 0) + 1
            elapsed = [json.loads(r["outcome"]).get("elapsed_s") for r in runs if r["outcome"]]
            elapsed = [e for e in elapsed if e is not None]
            tokens = [json.loads(r["metrics"]).get("total_tokens") for r in runs if r["metrics"]
                      and json.loads(r["metrics"]).get("token_usage") == "reported by provider"]
            print(f"| {scenario} | {'— (scripted)' if prov == 'fixture' else '`' + str(model) + '`'} | {len(runs)} | "
                  f"{sum(1 for r in runs if r['first_attempt_success'])}/{len(runs)} | "
                  f"{sum(1 for r in runs if r['eventual_success'])}/{len(runs)} | "
                  f"{', '.join(f'{k} {v}' for k, v in sorted(outcomes.items()))} | "
                  f"{f'{statistics.median(elapsed):.0f} s' if elapsed else '—'} | "
                  f"{f'{statistics.median(tokens):,.0f}' if tokens else 'unavailable'} |")
        print()


if __name__ == "__main__":
    main()
