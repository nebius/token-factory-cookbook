#!/usr/bin/env python3
"""Write pi's models.json for the live Nebius Token Factory catalog.

    python3 scripts/make_models.py --list      # show live models, write nothing
    python3 scripts/make_models.py             # write models.json in this folder
    python3 scripts/make_models.py --install   # also merge it into pi's own models.json

The output holds no key: it refers to the NEBIUS_API_KEY environment variable,
which pi reads when it sends a request.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

from tf_catalog import (
    PROVIDER_ID,
    build_provider,
    fetch_models,
    load_env_file,
    merge_provider,
    modality,
    requested_models,
    select_models,
)

RECIPE_DIR = Path(__file__).resolve().parent.parent
OUTPUT = RECIPE_DIR / "models.json"


def pi_agent_dir() -> Path:
    override = os.environ.get("PI_CODING_AGENT_DIR", "").strip()
    return Path(override).expanduser() if override else Path.home() / ".pi" / "agent"


def print_list(models: list[dict]) -> None:
    width = max(len(m["id"]) for m in models)
    print(f"{'MODEL ID':<{width}}  {'CONTEXT':>9}  THINKING  IMAGES")
    for m in models:
        features = m.get("supported_features") or []
        images = "yes" if "image" in modality(m).split("->")[0] else "no"
        print(f"{m['id']:<{width}}  {int(m.get('context_length') or 0):>9,}  "
              f"{'yes' if 'reasoning' in features else 'no':<8}  {images}")


def install(provider: dict) -> Path:
    target = pi_agent_dir() / "models.json"
    existing: dict = {}
    if target.exists():
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
        except ValueError:
            sys.exit(f"{target} is not valid JSON. Fix or move it, then run this again.")
        shutil.copy2(target, target.with_name("models.json.bak"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(merge_provider(existing, provider), indent=2) + "\n", encoding="utf-8")
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--list", action="store_true", help="print the live tool-capable models and exit")
    parser.add_argument("--install", action="store_true",
                        help="also merge the provider into pi's models.json (a .bak copy is kept)")
    args = parser.parse_args()

    load_env_file()
    catalog = fetch_models()
    if args.list:
        print_list(select_models(catalog, []))
        return

    models = select_models(catalog, requested_models())
    if not models:
        sys.exit("The catalog returned no model with tool calling. Check the key's access.")
    provider = build_provider(models)
    OUTPUT.write_text(json.dumps({"providers": {PROVIDER_ID: provider}}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT.name} with {len(models)} model(s) for provider {PROVIDER_ID}.")
    if args.install:
        print(f"Merged into {install(provider)}.")
    else:
        print("pi does not read this file yet. Run again with --install to add it to pi.")


if __name__ == "__main__":
    main()
