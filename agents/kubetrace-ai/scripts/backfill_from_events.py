"""Rebuild metrics and outcome for runs whose process exited before saving them (the headless CLI
did this before 2026-10-16). Everything comes from the run's recorded events; the result is marked
"reconstructed_from_events" so reports say so.

  uv run python scripts/backfill_from_events.py [run_id ...]   # default: every finished run missing metrics
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "artifacts" / "kubetrace.db"
TERMINAL = ("resolved", "escalated", "unresolved", "blocked", "cancelled")


def rebuild(conn: sqlite3.Connection, run_id: str) -> dict:
    events = [(r[0], r[1], json.loads(r[2])) for r in
              conn.execute("SELECT ts, type, payload FROM events WHERE run_id = ? ORDER BY id", (run_id,))]
    calls = [p for _, t, p in events if t == "model_call"]
    results = [p for _, t, p in events if t == "tool_result"]
    with_usage = [c["usage"] for c in calls if c.get("usage")]
    verifications = [p for _, t, p in events if t == "verification"]
    state = next((p["state"] for _, t, p in reversed(events) if t == "state"), None)
    started = next((ts for ts, t, p in events if t == "state" and p.get("state") == "investigating"), None)
    ended = next((ts for ts, t, p in reversed(events) if t == "state" and p.get("state") in TERMINAL), None)
    metrics = {
        "model_calls": len(calls), "model_latency_s": round(sum(c.get("latency_s", 0) for c in calls), 2),
        "prompt_tokens": sum(u["prompt_tokens"] for u in with_usage),
        "completion_tokens": sum(u["completion_tokens"] for u in with_usage),
        "total_tokens": sum(u["total_tokens"] for u in with_usage),
        "usage_reported_calls": len(with_usage), "tool_calls": len(results),
        "tool_time_s": round(sum(r.get("duration_ms", 0) for r in results) / 1000, 2),
        "tool_errors": sum(1 for r in results if not r.get("ok")),
        "rejected_actions": sum(1 for _, t, p in events if t == "policy_decision" and p.get("status") in ("denied", "rejected", "stale")),
        "verification_attempts": len(verifications),
        "token_usage": "reported by provider" if calls and len(with_usage) == len(calls) else "partial",
        "reconstructed_from_events": True,
    }
    reason = "independent verification passed" if state == "resolved" else (
        "a step or token limit was reached (the events do not record which)" if state == "unresolved" and not verifications else f"run ended {state}")
    outcome = {"final_state": state, "reason": reason + " (reconstructed from recorded events)",
               "verifications": verifications,
               "mutations": [dict(p, status=p.get("status", "applied")) for _, t, p in events if t in ("applied_change", "policy_decision")],
               "tests": [{k: v for k, v in p.items() if k != "workspace_diff"} for _, t, p in events if t == "test_result"],
               "builds": [p for _, t, p in events if t == "image_built"],
               "source_diff": next((p["workspace_diff"] for _, t, p in reversed(events) if t == "test_result"), ""),
               "elapsed_s": round(ended - started, 2) if started and ended else None,
               "reconstructed_from_events": True}
    first = verifications[0]["ok"] if verifications else None
    conn.execute("UPDATE runs SET metrics = ?, outcome = ?, ended_at = ?, first_attempt_success = ?, eventual_success = ? WHERE id = ?",
                 (json.dumps(metrics), json.dumps(outcome), ended, None if first is None else int(first),
                  int(state in ("resolved", "escalated")), run_id))
    return {"run": run_id, "state": state, "tokens": metrics["total_tokens"], "elapsed_s": outcome["elapsed_s"]}


def main() -> None:
    conn = sqlite3.connect(DB, isolation_level=None)
    ids = sys.argv[1:] or [r[0] for r in conn.execute(
        f"SELECT id FROM runs WHERE metrics IS NULL AND provenance != 'pending' AND state IN ({','.join('?' * len(TERMINAL))})", TERMINAL)]
    for run_id in ids:
        print(rebuild(conn, run_id))


if __name__ == "__main__":
    main()
