#!/usr/bin/env python3
"""Write Droid custom-model settings for the Token Factory models in TF_MODELS.

The output holds no key: each entry refers to the NEBIUS_API_KEY environment
variable, which Droid expands when it sends a request.

    python scripts/make_settings.py             # writes droid_settings.json here
    python scripts/make_settings.py --install   # also merges into ~/.factory/settings.json
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

from tf_models import (
    accepts_images,
    base_url,
    fetch_models,
    is_agent_capable,
    load_env_file,
    requested_models,
)

RECIPE_DIR = Path(__file__).resolve().parent.parent
OUTPUT = RECIPE_DIR / "droid_settings.json"
PROVIDER = "generic-chat-completion-api"
KEY_REFERENCE = "${NEBIUS_API_KEY}"
DEFAULT_MAX_OUTPUT_TOKENS = 16384
DISPLAY_PREFIX = "Nebius "
# Droid does not send a model's earlier reasoning back to it. A model that
# insists on getting it answers 400 unless its chat template is told otherwise.
ALLOW_MISSING_THINKING = {"chat_template_kwargs": {"allow_missing_thinking": True}}


def max_output_tokens() -> int:
    raw = os.environ.get("TF_MAX_OUTPUT_TOKENS", "").strip()
    if not raw:
        return DEFAULT_MAX_OUTPUT_TOKENS
    try:
        value = int(raw)
    except ValueError:
        sys.exit(f"TF_MAX_OUTPUT_TOKENS must be a whole number, got {raw!r}.")
    if value < 1024:
        sys.exit("TF_MAX_OUTPUT_TOKENS must be at least 1024.")
    return value


def allow_missing_thinking_models() -> set[str]:
    raw = os.environ.get("TF_ALLOW_MISSING_THINKING", "")
    return {model_id.strip() for model_id in raw.split(",") if model_id.strip()}


def base_model_ids() -> dict[str, str]:
    """Parse TF_BASE_MODEL_IDS: `<token-factory-id>=<droid-built-in-id>` pairs, comma separated."""
    pairs: dict[str, str] = {}
    for raw in os.environ.get("TF_BASE_MODEL_IDS", "").split(","):
        if not raw.strip():
            continue
        model_id, sep, built_in = raw.partition("=")
        if not sep or not model_id.strip() or not built_in.strip():
            sys.exit(
                f"TF_BASE_MODEL_IDS entry {raw.strip()!r} is not `<model-id>=<droid-model-id>`."
            )
        pairs[model_id.strip()] = built_in.strip()
    return pairs


def display_name(model_id: str) -> str:
    return DISPLAY_PREFIX + model_id.rsplit("/", 1)[-1]


def build_entry(
    model: dict,
    url: str,
    max_out: int,
    allow_missing_thinking: bool = False,
    base_model_id: str | None = None,
) -> dict:
    """One `customModels` entry for a live catalog row."""
    context = int(model.get("context_length") or 0)
    if context <= max_out:
        sys.exit(
            f"{model['id']} has a {context:,}-token window, which leaves no room for "
            f"{max_out:,} output tokens. Lower TF_MAX_OUTPUT_TOKENS."
        )
    entry = {
        "model": model["id"],
        "displayName": display_name(model["id"]),
        "baseUrl": url,
        "apiKey": KEY_REFERENCE,
        "provider": PROVIDER,
        "maxOutputTokens": max_out,
        # Token Factory's window counts prompt and output together, so leave
        # room for the reply, as Factory's BYOK page asks for such providers.
        "maxContextLimit": context - max_out,
        # Droid switches images off for this provider type unless told otherwise.
        "noImageSupport": not accepts_images(model),
    }
    if base_model_id:
        # Tells Droid which of its built-in models this one behaves like, so it
        # applies that model's prompts and reasoning handling.
        entry["baseModelId"] = base_model_id
    if allow_missing_thinking:
        entry["extraArgs"] = ALLOW_MISSING_THINKING
    return entry


def build_entries(
    catalog: list[dict],
    wanted: list[str],
    url: str,
    max_out: int,
    allow_missing_thinking: frozenset[str] | set[str] = frozenset(),
    base_models: dict[str, str] | None = None,
) -> list[dict]:
    base_models = base_models or {}
    by_id = {m["id"]: m for m in catalog}
    problems = [
        f"{model_id}: in TF_ALLOW_MISSING_THINKING but not in TF_MODELS"
        for model_id in sorted(set(allow_missing_thinking) - set(wanted))
    ] + [
        f"{model_id}: in TF_BASE_MODEL_IDS but not in TF_MODELS"
        for model_id in sorted(set(base_models) - set(wanted))
    ]
    for model_id in wanted:
        if model_id not in by_id:
            problems.append(f"{model_id}: not in the live catalog")
        elif not is_agent_capable(by_id[model_id]):
            problems.append(f"{model_id}: does not advertise tool calling, which Droid needs")
    if problems:
        sys.exit(
            "The model settings in .env need fixing:\n  "
            + "\n  ".join(problems)
            + "\nRun scripts/list_models.py to see what is live."
        )
    return [
        build_entry(
            by_id[model_id],
            url,
            max_out,
            model_id in allow_missing_thinking,
            base_models.get(model_id),
        )
        for model_id in wanted
    ]


def merge_custom_models(settings: dict, entries: list[dict], url: str) -> dict:
    """Replace this recipe's entries in a Droid settings object; keep everything else."""
    kept = [
        entry
        for entry in settings.get("customModels") or []
        if not (isinstance(entry, dict) and str(entry.get("baseUrl", "")).rstrip("/") == url)
    ]
    merged = dict(settings)
    merged["customModels"] = kept + entries
    return merged


def install(entries: list[dict], url: str) -> Path:
    target = Path.home() / ".factory" / "settings.json"
    settings: dict = {}
    if target.exists():
        try:
            settings = json.loads(target.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            sys.exit(f"{target} is not valid JSON ({exc}); fix it and run again.")
        if not isinstance(settings, dict):
            sys.exit(f"{target} does not hold a JSON object; not touching it.")
        shutil.copy2(target, target.with_name("settings.json.bak"))
    target.parent.mkdir(parents=True, exist_ok=True)
    merged = merge_custom_models(settings, entries, url)
    target.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--install",
        action="store_true",
        help="also merge the models into ~/.factory/settings.json (a .bak copy is kept)",
    )
    args = parser.parse_args()

    load_env_file()
    wanted = requested_models()
    if not wanted:
        sys.exit(
            "TF_MODELS is empty. Pick IDs with scripts/list_models.py, add them to "
            "TF_MODELS in .env, and save the file."
        )
    url = base_url()
    entries = build_entries(
        fetch_models(),
        wanted,
        url,
        max_output_tokens(),
        allow_missing_thinking_models(),
        base_model_ids(),
    )

    OUTPUT.write_text(json.dumps({"customModels": entries}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.name} with {len(entries)} model(s):")
    for entry in entries:
        print(f"  {entry['model']}  (shown as \"{entry['displayName']}\")")
    if args.install:
        print(f"Merged them into {install(entries, url)}")
    print(f"\nTry one:  droid exec --settings {OUTPUT} -m {entries[0]['model']} \"say hello\"")


if __name__ == "__main__":
    main()
