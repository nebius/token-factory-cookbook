"""
Helpers to run the Access Request environment server locally.

``openenv serve`` is still a placeholder in OpenEnv 0.4.x, so this starts the
FastAPI app directly with the same interpreter that runs the tutorial. Use it
from the notebook or with ``--start-server`` on the CLI scripts.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

HERE = Path(__file__).resolve().parent


def start_env_server(
    port: int = 8010,
    judge_model: Optional[str] = None,
    expose_policy_tool: bool = False,
    log_path: Optional[str] = None,
) -> subprocess.Popen:
    """Start the environment server in a background process and wait for /health."""
    env = os.environ.copy()
    if judge_model:
        env["ACCESS_ENV_JUDGE_MODEL"] = judge_model
    env["ACCESS_ENV_POLICY_TOOL"] = "1" if expose_policy_tool else "0"
    log_file = pathlib.Path(log_path) if log_path else HERE / "results" / f"env_server_{port}.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with open(log_file, "a") as log:  # the child inherits the descriptor; the parent's handle can close
        proc = subprocess.Popen(
            [sys.executable, "-m", "access_request_env.server.app", "--port", str(port), "--host", "127.0.0.1"],
            cwd=str(HERE),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    wait_for_health(f"http://127.0.0.1:{port}", process=proc)
    return proc


def wait_for_health(base_url: str, timeout_s: float = 60.0, process: Optional[subprocess.Popen] = None) -> None:
    deadline = time.time() + timeout_s
    last_error = None
    while time.time() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"Environment server exited early with code {process.returncode}")
        try:
            r = httpx.get(f"{base_url}/health", timeout=2.0)
            if r.status_code == 200:
                return
        except Exception as exc:  # server not up yet
            last_error = exc
        time.sleep(0.5)
    raise TimeoutError(f"Environment server at {base_url} did not become healthy: {last_error}")


def stop_env_server(proc: subprocess.Popen, timeout_s: float = 10.0) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.kill()
