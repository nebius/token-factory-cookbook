"""Run the Inspect smoke evaluation against Nebius Token Factory."""

from __future__ import annotations

import argparse
from pathlib import Path

from inspect_ai import eval

from settings import TokenFactorySettings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--log-dir",
        default="logs",
        help="Directory for Inspect evaluation logs (default: logs)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = TokenFactorySettings.from_env()
    settings.configure_openai_provider()

    logs = eval(
        "smoke_eval.py",
        model=settings.inspect_model,
        model_args={"responses_api": False},
        log_dir=str(Path(args.log_dir)),
        display="full",
    )
    return 0 if logs and all(log.status == "success" for log in logs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
