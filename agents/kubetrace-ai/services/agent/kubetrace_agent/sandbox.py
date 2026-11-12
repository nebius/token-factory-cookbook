"""Test runner and image builder adapters.

The test runner executes agent-written code in a disposable container: no network, no
credentials, no Docker socket, read-only source, dropped capabilities, memory and PID
limits. The image builder is a separate adapter that runs on the backend host; the agent
can ask for a build but never touches Docker itself.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from .settings import Settings

SUITES = {
    "unit": ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"],
    "lint": ["ruff", "check", "--no-cache", "storefront", "tests"],
}


@dataclass
class CommandResult:
    command: list[str]
    exit_code: int
    output: str
    duration_s: float
    isolation: str

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


class Runner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def run(self, source: Path, suite: str, extra_files: dict[str, str] | None = None, timeout: int = 180) -> CommandResult:
        if suite not in SUITES:
            raise ValueError(f"unknown suite {suite!r}; choose one of {sorted(SUITES)}")
        for rel, content in (extra_files or {}).items():
            target = source / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        command = list(SUITES[suite])
        if self.settings.test_runner == "docker":
            return self._docker(source, command, timeout)
        return self._subprocess(source, command, timeout)

    def _docker(self, source: Path, command: list[str], timeout: int) -> CommandResult:
        name = f"kubetrace-test-{uuid.uuid4().hex[:10]}"
        args = [self.settings.docker_bin, "run", "--rm", "--name", name,
                "--network", "none", "--memory", "512m", "--cpus", "1", "--pids-limit", "256",
                "--read-only", "--tmpfs", "/tmp:rw,size=64m", "--user", "10001:10001",
                "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
                "-e", "PYTHONDONTWRITEBYTECODE=1", "-e", "HOME=/tmp",
                "-v", f"{source.resolve()}:/work:ro", "-w", "/work", self.settings.runner_image, *command]
        started = time.monotonic()
        try:
            proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
            output, code = proc.stdout + proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as exc:
            subprocess.run([self.settings.docker_bin, "rm", "-f", name], capture_output=True)
            output, code = f"{exc.stdout or ''}{exc.stderr or ''}\n[timed out after {timeout} s]", 124
        return CommandResult(command, code, output, time.monotonic() - started,
                             "docker: --network none, read-only source, no credentials, no Docker socket")

    def _subprocess(self, source: Path, command: list[str], timeout: int) -> CommandResult:
        # Fallback when Docker is unavailable. Scrubbed environment, but not a sandbox.
        if command[0] == "python":
            command = [sys.executable, *command[1:]]
        elif command[0] == "ruff":
            command = [sys.executable, "-m", "ruff", *command[1:]]
        env = {"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1", "HOME": str(source)}
        started = time.monotonic()
        try:
            proc = subprocess.run(command, cwd=source, env=env, capture_output=True, text=True, timeout=timeout)
            output, code = proc.stdout + proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as exc:
            output, code = f"{exc.stdout or ''}{exc.stderr or ''}\n[timed out after {timeout} s]", 124
        return CommandResult(command, code, output, time.monotonic() - started,
                             "subprocess fallback: scrubbed environment, NOT isolated")


@dataclass
class BuiltImage:
    ref: str          # what the Deployment uses: a unique tag (kind) or a digest (registry)
    tag: str
    image_id: str
    digest: str | None
    build_output: str
    duration_s: float


class BuildError(Exception):
    pass


class ImageBuilder:
    """Builds the workspace Dockerfile on the backend host and makes the image reachable by the cluster."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _docker(self, *args: str, timeout: int = 600) -> str:
        proc = subprocess.run([self.settings.docker_bin, *args], capture_output=True, text=True, timeout=timeout,
                              env={**os.environ, "DOCKER_CLI_HINTS": "false"})
        if proc.returncode != 0:
            raise BuildError(f"docker {args[0]} failed:\n{(proc.stdout + proc.stderr)[-3000:]}")
        return proc.stdout + proc.stderr

    def build(self, source: Path, tag: str) -> BuiltImage:
        started = time.monotonic()
        repo = self.settings.image_repository
        if self.settings.cluster_kind == "civo":
            if not self.settings.registry:
                raise BuildError("REGISTRY is not set. Civo nodes pull from a registry; see docs/CIVO.md.")
            repo = f"{self.settings.registry.rstrip('/')}/{repo.split('/')[-1]}"
        full = f"{repo}:{tag}"
        platform = ["--platform", "linux/amd64"] if self.settings.cluster_kind == "civo" else []
        build = ["build", *platform, "--label", "kubetrace.ai/built=true", "-t", full, str(source)]
        try:
            output = self._docker(*build)
        except (BuildError, subprocess.TimeoutExpired):
            output = self._docker(*build)  # base-image metadata lookups fail on network blips; one retry
        image_id = self._docker("image", "inspect", "--format", "{{.Id}}", full).strip()
        digest = None
        if self.settings.cluster_kind == "civo":
            try:
                output += self._docker("push", full, timeout=900)
            except (BuildError, subprocess.TimeoutExpired):
                output += self._docker("push", full, timeout=900)  # registries hiccup; one retry
            repo_digest = self._docker("image", "inspect", "--format", "{{index .RepoDigests 0}}", full).strip()
            digest = repo_digest.split("@", 1)[1]
            ref = f"{repo}@{digest}"
        else:
            output += self._kind_load(full)
            ref = full
        return BuiltImage(ref=ref, tag=full, image_id=image_id, digest=digest,
                          build_output=output[-4000:], duration_s=time.monotonic() - started)

    def _kind_load(self, image: str) -> str:
        proc = subprocess.run(["kind", "load", "docker-image", image, "--name", self.settings.kind_cluster_name],
                              capture_output=True, text=True, timeout=300,
                              env={**os.environ, "PATH": f"{Path(self.settings.docker_bin).parent}:{os.environ.get('PATH', '')}"})
        if proc.returncode != 0:
            raise BuildError(f"kind load failed:\n{proc.stdout}{proc.stderr}")
        return proc.stdout + proc.stderr
