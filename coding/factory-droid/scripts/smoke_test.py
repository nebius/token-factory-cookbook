#!/usr/bin/env python3
"""Live check: can Droid fix a bug and run the tests on each configured model?

For every model in TF_MODELS (or the ones named on the command line) this
creates a throwaway two-file Python project with one failing test, asks
`droid exec` to fix it, then runs the tests itself. A model passes only if the
tests pass afterwards and the test file is unchanged; what the model says about
its own work is not trusted.

Every run is a handful of paid Token Factory requests.

    python scripts/smoke_test.py
    python scripts/smoke_test.py --runs 3 some-org/some-model
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from tf_models import api_key, load_env_file, requested_models

RECIPE_DIR = Path(__file__).resolve().parent.parent
SETTINGS = RECIPE_DIR / "droid_settings.json"
TIMEOUT_SECONDS = 420

CALC = (
    "def add(a, b):\n    return a - b\n\n\n"
    "def mean(values):\n    return add(sum(values), 0) / len(values)\n"
)
TEST = (
    "import unittest\n\nfrom calc import add, mean\n\n\n"
    "class CalcTest(unittest.TestCase):\n"
    "    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n\n"
    "    def test_mean(self):\n        self.assertEqual(mean([2, 4, 6]), 4)\n\n\n"
    'if __name__ == "__main__":\n    unittest.main()\n'
)
PROMPT = (
    "Run python3 -m unittest in this folder, fix the bug in calc.py, then run the "
    "tests again to confirm they pass. Do not edit test_calc.py. Reply with one line when done."
)


def summarize_events(stdout: str) -> dict:
    """Pull tool-call count, CLI errors and the last reply out of `-o stream-json` output."""
    tool_calls = 0
    cli_errors: list[str] = []
    last_reply = ""
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        kind = event.get("type")
        if kind == "tool_call":
            tool_calls += 1
        elif kind == "error":
            cli_errors.append(str(event.get("message", ""))[:200])
        elif kind == "message" and event.get("role") == "assistant":
            last_reply = str(event.get("text", ""))[:200]
    return {"tool_calls": tool_calls, "cli_errors": cli_errors, "last_reply": last_reply}


def run_once(droid: str, model_id: str, key: str) -> dict:
    work = Path(tempfile.mkdtemp(prefix="droid-tf-smoke-"))
    try:
        (work / "calc.py").write_text(CALC, encoding="utf-8")
        (work / "test_calc.py").write_text(TEST, encoding="utf-8")
        # A small environment: Droid's shell commands inherit it, and they need
        # nothing from yours beyond these.
        env = {name: os.environ[name] for name in ("HOME", "PATH", "TERM", "LANG") if name in os.environ}
        env["NEBIUS_API_KEY"] = key
        command = [
            droid, "exec",
            "--settings", str(SETTINGS),
            "-m", model_id,
            "--auto", "medium",
            "-o", "stream-json",
            "--cwd", str(work),
            PROMPT,
        ]
        started = time.monotonic()
        try:
            done = subprocess.run(
                command, cwd=work, env=env, capture_output=True, text=True, timeout=TIMEOUT_SECONDS
            )
            exit_code: int | str = done.returncode
            stdout, stderr = done.stdout, done.stderr
        except subprocess.TimeoutExpired:
            exit_code, stdout, stderr = "timeout", "", ""
        seconds = time.monotonic() - started
        tests = subprocess.run(
            [sys.executable, "-m", "unittest"], cwd=work, capture_output=True, text=True
        )
        summary = summarize_events(stdout)
        passed = tests.returncode == 0 and (work / "test_calc.py").read_text(encoding="utf-8") == TEST
        notes = list(summary["cli_errors"])
        if not passed:
            # Say what Droid did, so a failure can be told apart from a model
            # that stopped early or a request that never went out.
            notes.append(f"droid exit {exit_code}, {summary['tool_calls']} tool call(s)")
            if stderr.strip():
                notes.append("stderr: " + stderr.strip()[:200])
            if summary["last_reply"]:
                notes.append("last reply: " + summary["last_reply"])
            elif not summary["cli_errors"]:
                notes.append("no reply text; first output: " + (stdout.strip()[:200] or "(none)"))
        return {
            "passed": passed,
            "exit": exit_code,
            "seconds": seconds,
            "tool_calls": summary["tool_calls"],
            "errors": [note.replace(key, "[key removed]") for note in notes],
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("models", nargs="*", help="model IDs to test (default: TF_MODELS)")
    parser.add_argument("--runs", type=int, default=1, help="runs per model (default 1)")
    args = parser.parse_args()

    load_env_file()
    droid = shutil.which("droid")
    if not droid:
        sys.exit("`droid` is not on PATH. Install it first: https://docs.factory.com/droid-cli/quickstart")
    if not SETTINGS.exists():
        sys.exit(f"{SETTINGS.name} is missing. Run scripts/make_settings.py first.")
    configured = [m["model"] for m in json.loads(SETTINGS.read_text(encoding="utf-8"))["customModels"]]
    models = args.models or requested_models() or configured
    unknown = [m for m in models if m not in configured]
    if unknown:
        sys.exit(f"Not in {SETTINGS.name}: {', '.join(unknown)}. Add them to TF_MODELS and rerun make_settings.py.")
    key = api_key()

    failed = False
    width = max(len(m) for m in models)
    print(f"{'MODEL':<{width}}  RESULT  PASSED  SECONDS  TOOL CALLS")
    for model_id in models:
        results = [run_once(droid, model_id, key) for _ in range(max(1, args.runs))]
        passed = sum(r["passed"] for r in results)
        ok = passed == len(results)
        failed = failed or not ok
        seconds = sum(r["seconds"] for r in results) / len(results)
        calls = sum(r["tool_calls"] for r in results) / len(results)
        print(
            f"{model_id:<{width}}  {'ok' if ok else 'FAIL':<6}  {passed}/{len(results):<4}  "
            f"{seconds:>7.1f}  {calls:>10.1f}"
        )
        for note in dict.fromkeys(e for r in results for e in r["errors"]):
            print(f"    {note}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
