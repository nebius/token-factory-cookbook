"""Validate OpenCode's Models.dev-derived Token Factory provider contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

CATALOG_URL = "https://models.dev/api.json"
CANONICAL_API = "https://api.tokenfactory.nebius.com/v1"
PROVIDER_ID = "nebius"


def load_catalog(source: str) -> dict[str, Any]:
    if source.startswith(("https://", "http://")):
        request = Request(source, headers={"User-Agent": "token-factory-cookbook/1"})
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    with Path(source).open(encoding="utf-8") as handle:
        return json.load(handle)


def validate(catalog: dict[str, Any], model_id: str | None = None) -> list[str]:
    errors: list[str] = []
    provider = catalog.get(PROVIDER_ID)
    if not isinstance(provider, dict):
        return ["Models.dev catalog has no 'nebius' provider"]

    expected = {
        "id": PROVIDER_ID,
        "name": "Nebius Token Factory",
        "api": CANONICAL_API,
        "npm": "@ai-sdk/openai-compatible",
    }
    for field, value in expected.items():
        if provider.get(field) != value:
            errors.append(
                f"nebius.{field} must be {value!r}, got {provider.get(field)!r}"
            )

    if "NEBIUS_API_KEY" not in provider.get("env", []):
        errors.append("nebius.env must include NEBIUS_API_KEY")

    models = provider.get("models")
    if not isinstance(models, dict) or not models:
        errors.append("nebius.models must contain at least one model")
        return errors

    if model_id is None:
        return errors
    model = models.get(model_id)
    if not isinstance(model, dict):
        errors.append(f"model {model_id!r} is not present under the nebius provider")
        return errors
    if model.get("status") == "deprecated":
        errors.append(f"model {model_id!r} is deprecated")
    if model.get("tool_call") is not True:
        errors.append(f"model {model_id!r} is not marked tool-call capable")
    modalities = model.get("modalities", {})
    if "text" not in modalities.get("input", []):
        errors.append(f"model {model_id!r} does not declare text input")
    if "text" not in modalities.get("output", []):
        errors.append(f"model {model_id!r} does not declare text output")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", default=CATALOG_URL)
    parser.add_argument("--model", help="active tool-capable model ID to require")
    args = parser.parse_args()

    try:
        errors = validate(load_catalog(args.catalog), args.model)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"catalog validation failed: {exc}", file=sys.stderr)
        return 2
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    suffix = f" and model {args.model}" if args.model else ""
    print(f"Validated Models.dev provider {PROVIDER_ID}{suffix}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
