#!/usr/bin/env python3
"""Live check: can pi fix a bug and run the tests on a Token Factory model?

For each model named on the command line (or in TF_MODELS) this creates a
throwaway two-file Python project with one failing test, asks pi to fix it,
then runs the tests itself. A model passes only if the tests pass afterwards
and the test file is unchanged; what the model says about its own work is not
trusted. pi runs against a private settings folder (.pi-agent here), so your
own pi configuration is not read or changed.

Every run is a handful of paid Token Factory requests.

    python3 scripts/smoke_test.py some-org/some-model
    python3 scripts/smoke_test.py --runs 3 some-org/some-model
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

from tf_catalog import PROVIDER_ID, api_key, load_env_file, requested_models

RECIPE_DIR = Path(__file__).resolve().parent.parent
MODELS_FILE = RECIPE_DIR / "models.json"
AGENT_DIR = RECIPE_DIR / ".pi-agent"
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
    """Pull tool calls, errors and the last reply out of `pi --mode json` output.

    pi exits 0 even when the provider rejects a request, so the error has to be
    read from the events.
    """
    tool_calls = 0
    errors: list[str] = []
    last_reply = ""
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "tool_execution_start":
            tool_calls += 1
        if event.get("type") != "message_end":
            continue
        message = event.get("message") or {}
        if message.get("role") != "assistant":
            continue
        if message.get("errorMessage"):
            errors.append(str(message["errorMessage"])[:200])
        texts = [part.get("text", "") for part in message.get("content") or [] if part.get("type") == "text"]
        if any(texts):
            last_reply = " ".join(texts)[:200]
    return {"tool_calls": tool_calls, "errors": errors, "last_reply": last_reply}


def run_once(pi: str, model_id: str, key: str) -> dict:
    work = Path(tempfile.mkdtemp(prefix="pi-tf-smoke-"))
    try:
        (work / "calc.py").write_text(CALC, encoding="utf-8")
        (work / "test_calc.py").write_text(TEST, encoding="utf-8")
        # A small environment: pi's shell commands inherit it, and they need
        # nothing from yours beyond these.
        env = {name: os.environ[name] for name in ("HOME", "PATH", "TERM", "LANG") if name in os.environ}
        env.update(NEBIUS_API_KEY=key, PI_CODING_AGENT_DIR=str(AGENT_DIR))
        command = [pi, "--provider", PROVIDER_ID, "--model", model_id, "--no-session", "--mode", "json", PROMPT]
        started = time.monotonic()
        try:
            # Without stdin closed, pi waits for piped input and never starts.
            done = subprocess.run(command, cwd=work, env=env, stdin=subprocess.DEVNULL,
                                  capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
            exit_code: int | str = done.returncode
            stdout, stderr = done.stdout, done.stderr
        except subprocess.TimeoutExpired:
            exit_code, stdout, stderr = "timeout", "", ""
        seconds = time.monotonic() - started
        tests = subprocess.run([sys.executable, "-m", "unittest"], cwd=work, capture_output=True, text=True)
        summary = summarize_events(stdout)
        passed = tests.returncode == 0 and (work / "test_calc.py").read_text(encoding="utf-8") == TEST
        notes = list(summary["errors"])
        if not passed:
            notes.append(f"pi exit {exit_code}, {summary['tool_calls']} tool call(s)")
            if stderr.strip():
                notes.append("stderr: " + stderr.strip()[:200])
            if summary["last_reply"]:
                notes.append("last reply: " + summary["last_reply"])
        return {
            "passed": passed,
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
    pi = shutil.which("pi")
    if not pi:
        sys.exit("`pi` is not on PATH. Install it first: https://pi.dev")
    if not MODELS_FILE.exists():
        sys.exit(f"{MODELS_FILE.name} is missing. Run scripts/make_models.py first.")
    configured = [m["id"] for m in json.loads(MODELS_FILE.read_text(encoding="utf-8"))["providers"][PROVIDER_ID]["models"]]
    models = args.models or requested_models()
    if not models:
        sys.exit("Name at least one model ID, or set TF_MODELS in .env. See them with scripts/make_models.py --list.")
    unknown = [m for m in models if m not in configured]
    if unknown:
        sys.exit(f"Not in {MODELS_FILE.name}: {', '.join(unknown)}. Run scripts/make_models.py again.")
    key = api_key()
    AGENT_DIR.mkdir(exist_ok=True)
    shutil.copy2(MODELS_FILE, AGENT_DIR / "models.json")

    failed = False
    width = max(len(m) for m in models)
    print(f"{'MODEL':<{width}}  RESULT  PASSED  SECONDS  TOOL CALLS")
    for model_id in models:
        results = [run_once(pi, model_id, key) for _ in range(max(1, args.runs))]
        passed = sum(r["passed"] for r in results)
        ok = passed == len(results)
        failed = failed or not ok
        seconds = sum(r["seconds"] for r in results) / len(results)
        calls = sum(r["tool_calls"] for r in results) / len(results)
        print(f"{model_id:<{width}}  {'ok' if ok else 'FAIL':<6}  {passed}/{len(results):<4}  "
              f"{seconds:>7.1f}  {calls:>10.1f}")
        for note in dict.fromkeys(e for r in results for e in r["errors"]):
            print(f"    {note}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
