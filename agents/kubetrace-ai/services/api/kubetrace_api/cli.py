"""Command line: serve the API, check the provider, or run an experiment headless.

  kubetrace serve [--host 127.0.0.1] [--port 8000]
  kubetrace preflight
  kubetrace run <scenario> [--model-mode live|fixture] [--policy auto|review]
"""
from __future__ import annotations

import argparse
import json
import sys
import time


def main() -> None:
    parser = argparse.ArgumentParser(prog="kubetrace")
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    sub.add_parser("preflight")
    r = sub.add_parser("run")
    r.add_argument("scenario")
    r.add_argument("--model-mode", default="live", choices=["live", "fixture"])
    r.add_argument("--policy", default="auto", choices=["auto", "review"])
    args = parser.parse_args()

    if args.cmd == "serve":
        import uvicorn
        uvicorn.run("kubetrace_api.main:app", host=args.host, port=args.port, log_level="info")
        return
    if args.cmd == "preflight":
        from kubetrace_agent.llm import preflight
        from kubetrace_agent.settings import get_settings
        result = preflight(get_settings())
        for c in result["checks"]:
            print(f"{'PASS' if c['ok'] else 'FAIL'}  {c['name']}: {c['detail']}")
        sys.exit(0 if result["ok"] else 1)
    if args.cmd == "run":
        from .main import clusters, connect_on_start, db, manager
        from .runs import TERMINAL
        connect_on_start()
        if not clusters.handle:
            sys.exit(f"not connected: {clusters.error}")
        run_id = manager.run_all(args.scenario, args.policy, args.model_mode)
        print(f"run {run_id}")
        seen = 0
        while True:
            for e in db.events(run_id, seen):
                seen = e["id"]
                p = e["payload"]
                detail = p.get("state") or p.get("tool") or p.get("text") or p.get("step") or ""
                print(f"{time.strftime('%H:%M:%S', time.localtime(e['ts']))}  {e['type']:<16} {str(detail)[:110]}")
            run = db.get_run(run_id)
            # Wait for ended_at too: the outcome and metrics are saved just after the final state.
            if run["state"] in TERMINAL and (run.get("ended_at") or run["state"] == "error"):
                print(json.dumps({"state": run["state"], "metrics": run.get("metrics")}, indent=1))
                sys.exit(0 if run.get("eventual_success") else 2)
            time.sleep(1)


if __name__ == "__main__":
    main()
