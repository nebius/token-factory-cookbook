#!/usr/bin/env python3
"""Fail when a tracked Markdown document links to a missing local path."""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPO_ROOT = Path(__file__).resolve().parents[2]
MARKDOWN_SUFFIXES = {".md", ".mdx"}
INLINE_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")
REFERENCE_LINK_RE = re.compile(r"^\s*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)
HTML_LINK_RE = re.compile(r"(?:href|src)\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
FENCE_RE = re.compile(r"^\s*(```|~~~)")
IGNORED_SCHEMES = {
    "data",
    "http",
    "https",
    "mailto",
    "tel",
}


@dataclass(frozen=True)
class BrokenLink:
    document: Path
    line: int
    target: str
    resolved: Path


def tracked_markdown_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    return sorted(
        REPO_ROOT / path.decode()
        for path in result.stdout.split(b"\0")
        if path and Path(path.decode()).suffix.lower() in MARKDOWN_SUFFIXES
    )


def without_fenced_code(text: str) -> str:
    kept: list[str] = []
    in_fence = False
    fence_marker = ""
    for line in text.splitlines(keepends=True):
        match = FENCE_RE.match(line)
        if match:
            marker = match.group(1)
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = ""
            kept.append("\n" if line.endswith("\n") else "")
        elif in_fence:
            kept.append("\n" if line.endswith("\n") else "")
        else:
            kept.append(line)
    return "".join(kept)


def destinations(text: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    for pattern in (INLINE_LINK_RE, REFERENCE_LINK_RE, HTML_LINK_RE):
        for match in pattern.finditer(text):
            target = match.group(1).strip()
            if target.startswith("<") and ">" in target:
                target = target[1 : target.index(">")]
            elif " " in target:
                target = target.split(maxsplit=1)[0]
            found.append((text.count("\n", 0, match.start()) + 1, target))
    return found


def resolve_local_target(document: Path, target: str) -> Path | None:
    if not target or target.startswith("#"):
        return None

    parsed = urlsplit(target)
    if parsed.scheme.lower() in IGNORED_SCHEMES or parsed.netloc:
        return None

    path_text = unquote(parsed.path)
    if not path_text:
        return None

    if path_text.startswith("/"):
        candidate = REPO_ROOT / path_text.lstrip("/")
    else:
        candidate = document.parent / path_text
    return candidate.resolve()


def find_broken_links() -> list[BrokenLink]:
    broken: list[BrokenLink] = []
    for document in tracked_markdown_files():
        text = without_fenced_code(document.read_text(encoding="utf-8"))
        for line, target in destinations(text):
            resolved = resolve_local_target(document, target)
            if resolved is not None and not resolved.exists():
                broken.append(BrokenLink(document, line, target, resolved))
    return broken


def main() -> int:
    broken = find_broken_links()
    if not broken:
        print("All tracked Markdown internal links resolve.")
        return 0

    for link in broken:
        document = link.document.relative_to(REPO_ROOT)
        try:
            resolved = link.resolved.relative_to(REPO_ROOT)
        except ValueError:
            resolved = link.resolved
        print(f"{document}:{link.line}: {link.target} -> missing {resolved}")
    print(f"Found {len(broken)} broken internal link(s).", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
