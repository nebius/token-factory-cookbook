"""Per-run Git workspace holding the demo application source and its manifests.

The workspace is the source of truth for a run: the agent edits files here, tests and
image builds use it, and every applied cluster change is reconciled back into it.
"""
from __future__ import annotations

import fnmatch
import shutil
import subprocess
from pathlib import Path

from .settings import ROOT

TEMPLATE = ROOT / "demo" / "app"
COPY_ITEMS = ["storefront", "tests", "docs", "k8s", "Dockerfile", "pyproject.toml", ".gitignore"]
# What the agent may change. The probe manifest and anything else stay read-only.
WRITABLE = ["storefront/*.py", "tests/*.py", "k8s/deployment.yaml", "k8s/service.yaml", "k8s/configmap.yaml"]
MAX_FILE_BYTES = 64_000
GIT_ENV = {"GIT_AUTHOR_NAME": "kubetrace", "GIT_AUTHOR_EMAIL": "kubetrace@localhost",
           "GIT_COMMITTER_NAME": "kubetrace", "GIT_COMMITTER_EMAIL": "kubetrace@localhost",
           "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "PATH": "/usr/bin:/bin:/opt/homebrew/bin"}


class WorkspaceError(Exception):
    pass


class Workspace:
    def __init__(self, path: Path) -> None:
        self.path = path

    @classmethod
    def create(cls, path: Path, variables: dict[str, str]) -> "Workspace":
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True)
        for item in COPY_ITEMS:
            src = TEMPLATE / item
            if src.is_dir():
                shutil.copytree(src, path / item, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
            elif src.exists():
                shutil.copy2(src, path / item)
        for manifest in (path / "k8s").glob("*.yaml"):
            text = manifest.read_text()
            for key, value in variables.items():
                text = text.replace("${" + key + "}", value)
            manifest.write_text(text)
        ws = cls(path)
        ws.git("init", "-q", "-b", "main")
        ws.commit("Baseline: storefront as released")
        return ws

    def git(self, *args: str) -> str:
        proc = subprocess.run(["git", *args], cwd=self.path, env=GIT_ENV, capture_output=True, text=True, timeout=30)
        if proc.returncode != 0:
            raise WorkspaceError(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
        return proc.stdout

    def commit(self, message: str) -> str:
        self.git("add", "-A")
        if self.git("status", "--porcelain").strip():
            self.git("commit", "-q", "-m", message)
        return self.head()

    def head(self) -> str:
        return self.git("rev-parse", "HEAD").strip()

    def resolve(self, relative: str) -> Path:
        candidate = (self.path / relative).resolve()
        if self.path.resolve() not in candidate.parents and candidate != self.path.resolve():
            raise WorkspaceError(f"path is outside the workspace: {relative}")
        if ".git" in candidate.relative_to(self.path.resolve()).parts:
            raise WorkspaceError("the .git directory is not accessible")
        return candidate

    def is_writable(self, relative: str) -> bool:
        normalized = str(Path(relative))
        return any(fnmatch.fnmatch(normalized, pattern) for pattern in WRITABLE)

    def list_files(self) -> list[dict]:
        out = []
        for p in sorted(self.path.rglob("*")):
            rel = p.relative_to(self.path)
            if p.is_file() and ".git" not in rel.parts and "__pycache__" not in rel.parts and ".pytest_cache" not in rel.parts:
                out.append({"path": str(rel), "bytes": p.stat().st_size, "writable": self.is_writable(str(rel))})
        return out

    def read(self, relative: str) -> str:
        path = self.resolve(relative)
        if not path.is_file():
            raise WorkspaceError(f"no such file: {relative}")
        return path.read_text()

    def write(self, relative: str, content: str) -> None:
        if not self.is_writable(relative):
            raise WorkspaceError(f"{relative} is not writable. Writable paths: {', '.join(WRITABLE)}")
        if len(content.encode()) > MAX_FILE_BYTES:
            raise WorkspaceError(f"file too large (limit {MAX_FILE_BYTES} bytes)")
        path = self.resolve(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def edit(self, relative: str, old: str, new: str) -> None:
        text = self.read(relative)
        count = text.count(old)
        if count != 1:
            raise WorkspaceError(f"old_text must match exactly once in {relative}; it matched {count} times")
        self.write(relative, text.replace(old, new))

    def diff(self, base: str = "HEAD") -> str:
        """Unified diff of uncommitted changes, including new files."""
        self.git("add", "-A", "-N")
        return self.git("diff", base, "--no-color")

    def diff_between(self, base: str, head: str = "HEAD") -> str:
        return self.git("diff", base, head, "--no-color")

    def export_commit(self, commit: str, dest: Path) -> Path:
        """The tree of an earlier commit, as plain files."""
        import io
        import tarfile
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        proc = subprocess.run(["git", "archive", "--format=tar", commit], cwd=self.path, env=GIT_ENV,
                              capture_output=True, timeout=30)
        if proc.returncode != 0:
            raise WorkspaceError(f"git archive failed: {proc.stderr.decode()[:300]}")
        with tarfile.open(fileobj=io.BytesIO(proc.stdout)) as tar:
            tar.extractall(dest, filter="data")
        return dest

    def snapshot(self, dest: Path) -> Path:
        """A plain copy without .git, for the test runner and the image build."""
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(self.path, dest, ignore=shutil.ignore_patterns(".git", "__pycache__", ".pytest_cache"))
        return dest
