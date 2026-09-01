#!/usr/bin/env python3
"""Reject stale Token Factory API hosts and discontinued active model examples."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHECKED_SUFFIXES = {
    ".env",
    ".ipynb",
    ".js",
    ".json",
    ".md",
    ".mdx",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
LEGACY_HOSTS = (
    "api.studio.nebius.ai",
    "api.studio.nebius.com",
)
DISCONTINUED_PUBLIC_MODELS = (
    "moonshotai/Kimi-K2.5-fast",
    "moonshotai/Kimi-K2.5",
    "deepseek-ai/DeepSeek-V3.2-fast",
    "deepseek-ai/DeepSeek-V3.2",
    "openai/gpt-oss-120b-fast",
    "MiniMaxAI/MiniMax-M2.5-fast",
    "Qwen/Qwen3-235B-A22B-Thinking-2507-fast",
    "Qwen/Qwen3.5-397B-A17B-fast",
    "Qwen/Qwen3-Next-80B-A3B-Thinking-fast",
    "zai-org/GLM-5",
    "PrimeIntellect/INTELLECT-3",
)
SELF = Path(".github/scripts/check_api_contracts.py")


def is_checked_file(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if path.suffix not in CHECKED_SUFFIXES or relative == SELF:
        return False
    if any(part in {".git", ".venv", "__pycache__"} for part in relative.parts):
        return False
    return True


def scan() -> list[str]:
    failures: list[str] = []
    for path in sorted(item for item in ROOT.rglob("*") if item.is_file() and is_checked_file(item)):
        relative = path.relative_to(ROOT)
        text = path.read_text(encoding="utf-8", errors="ignore")
        for host in LEGACY_HOSTS:
            if host in text:
                failures.append(f"{relative}: legacy API host {host}")
        if relative.parts[:2] == ("models", "archived"):
            continue
        # Vendor/source links can legitimately name an old model or repository.
        # Runtime snippets and Token Factory playground links remain checked.
        model_text = re.sub(
            r"\[[^\]]+\]\(https://(?:github\.com|huggingface\.co)/[^)]+\)",
            "",
            text,
        )
        model_text = re.sub(
            r"https://(?:github\.com|huggingface\.co)/[^\s)>\]\"']+",
            "",
            model_text,
        )
        for model in DISCONTINUED_PUBLIC_MODELS:
            pattern = rf"(?<![A-Za-z0-9_.-]){re.escape(model)}(?![A-Za-z0-9_.-])"
            if re.search(pattern, model_text):
                failures.append(f"{relative}: discontinued Public Serverless model {model}")
    return failures


def main() -> int:
    failures = scan()
    if failures:
        print("Token Factory API contract check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("Token Factory API contract check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
