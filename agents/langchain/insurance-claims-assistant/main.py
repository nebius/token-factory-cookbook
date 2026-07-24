"""CLI entrypoint for the Insurance Claims Assistant.

    python main.py --claim path/to/claim_folder/         # interactive confirm
    python main.py --claim path/to/claim_folder/ --yes   # auto-confirm (batch/CI)

Drop in a folder of arbitrary claim documents (PDFs, photos, a JSON form). The agent reads
everything, tells you what it thinks the claim is, lets you confirm or add context, then
prints the structured assessment plus a rendered report.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from claims_assistant.agent import assess, perceive, understand
from claims_assistant.models import ClaimUnderstanding
from claims_assistant.report import render_markdown, render_understanding

DEFAULT_CLAIM = Path(__file__).parent / "sample_claim"


def _confirm_interactively(u: ClaimUnderstanding) -> tuple[bool, str]:
    print("\n" + render_understanding(u) + "\n")
    reply = input("Proceed with the assessment? [Y/n, or type a correction] ").strip()
    if reply.lower() in {"n", "no"}:
        return False, ""
    if reply and reply.lower() not in {"y", "yes"}:
        # Anything else is treated as a correction / answer to the follow-ups.
        return True, reply
    if u.open_questions:
        extra = input("Any answers to the follow-up questions? (optional) ").strip()
        return True, extra
    return True, ""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Nebius Token Factory multimodal insurance claims assistant."
    )
    parser.add_argument("--claim", type=Path, default=DEFAULT_CLAIM,
                        help="Path to a claim folder (default: bundled sample_claim/).")
    parser.add_argument("--yes", action="store_true",
                        help="Auto-confirm the agent's understanding (no prompt).")
    parser.add_argument("--json-only", action="store_true",
                        help="Print only the JSON assessment.")
    args = parser.parse_args()

    print(f"Reading claim folder: {args.claim} …")
    insights, stated_claim = perceive(args.claim)
    print(f"Read {len(insights)} file(s). Analysing…")
    understanding = understand(insights, stated_claim)

    note = ""
    if not args.yes:
        proceed, note = _confirm_interactively(understanding)
        if not proceed:
            print("Cancelled.")
            return 1
    else:
        print("\n" + render_understanding(understanding) + "\n")

    assessment = assess(insights, stated_claim, understanding, note)

    print("\n" + "=" * 72 + "\n")
    print(assessment.model_dump_json(indent=2))
    if not args.json_only:
        print("\n" + "=" * 72 + "\n")
        print(render_markdown(assessment))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
