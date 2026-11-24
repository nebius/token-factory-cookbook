"""Live Nebius Token Factory catalog, mapped to pi's models.json (standard library only).

Nothing here hardcodes a model ID, a context window or a price. All of it is
read from GET /v1/models?verbose=true when a script runs.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_URL = "https://api.tokenfactory.nebius.com/v1"
PROVIDER_ID = "nebius-token-factory"
KEY_REFERENCE = "$NEBIUS_API_KEY"
MAX_OUTPUT_TOKENS = 32768
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load_env_file(path: Path = ENV_FILE) -> None:
    """Read KEY=VALUE lines from the recipe's .env into the environment."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.removeprefix("export ").partition("=")
        name, value = name.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if name and value:
            os.environ[name] = value


def api_key() -> str:
    key = os.environ.get("NEBIUS_API_KEY", "").strip()
    if not key:
        sys.exit("NEBIUS_API_KEY is not set. Run `cp env.example .env`, put your key in it and save the file.")
    return key


def fetch_models() -> list[dict]:
    """Return the live catalog. Exits with a readable message on failure."""
    request = urllib.request.Request(
        f"{BASE_URL}/models?verbose=true",
        headers={"Authorization": f"Bearer {api_key()}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode()
    except urllib.error.HTTPError as exc:
        # /v1/models can answer an error as text/plain, so do not assume JSON here.
        sys.exit(f"GET /v1/models failed: HTTP {exc.code} {exc.read().decode()[:200]}")
    except urllib.error.URLError as exc:
        sys.exit(f"GET /v1/models failed: {exc.reason}")
    return json.loads(body)["data"]


def modality(model: dict) -> str:
    return (model.get("architecture") or {}).get("modality", "")


def is_agent_capable(model: dict) -> bool:
    """pi drives a model through tool calls, so only text models that advertise tools qualify."""
    features = model.get("supported_features") or []
    return "tools" in features and modality(model).endswith("->text")


def requested_models() -> list[str]:
    """Model IDs from TF_MODELS, comma separated, in order, without duplicates."""
    seen: list[str] = []
    for raw in os.environ.get("TF_MODELS", "").split(","):
        model_id = raw.strip()
        if model_id and model_id not in seen:
            seen.append(model_id)
    return seen


def per_million(raw: object) -> float:
    """The API prices one token as a string; pi wants USD per million tokens."""
    try:
        return round(float(raw) * 1_000_000, 6)
    except (TypeError, ValueError):
        return 0.0


def to_pi_model(model: dict) -> dict:
    features = model.get("supported_features") or []
    pricing = model.get("pricing") or {}
    context = int(model.get("context_length") or 0)
    entry = {
        "id": model["id"],
        "name": f"{model.get('name') or model['id']} (Nebius)",
        "reasoning": "reasoning" in features,
        "input": ["text", "image"] if "image" in modality(model).split("->")[0] else ["text"],
        "cost": {
            "input": per_million(pricing.get("prompt")),
            "output": per_million(pricing.get("completion")),
            "cacheRead": per_million(pricing.get("input_cache_read")),
            "cacheWrite": 0,
        },
    }
    if context > 0:
        entry["contextWindow"] = context
        entry["maxTokens"] = min(context, MAX_OUTPUT_TOKENS)
    return entry


def select_models(catalog: list[dict], wanted: list[str]) -> list[dict]:
    """The tool-capable models, or only the wanted ones. Exits if a wanted ID is not usable."""
    capable = {m["id"]: m for m in catalog if m.get("id") and is_agent_capable(m)}
    if not wanted:
        return [capable[model_id] for model_id in sorted(capable)]
    missing = [model_id for model_id in wanted if model_id not in capable]
    if missing:
        sys.exit(
            "Not live, or without tool calling: " + ", ".join(missing)
            + ". Run `python3 scripts/make_models.py --list` and fix TF_MODELS in .env."
        )
    return [capable[model_id] for model_id in wanted]


def build_provider(models: list[dict]) -> dict:
    """One pi provider entry. The key is referred to by name and never written."""
    return {
        "name": "Nebius Token Factory",
        "baseUrl": BASE_URL,
        "apiKey": KEY_REFERENCE,
        "api": "openai-completions",
        # Token Factory takes the system prompt as `system` and the output cap as `max_tokens`.
        "compat": {"supportsDeveloperRole": False, "maxTokensField": "max_tokens"},
        "models": [to_pi_model(m) for m in models],
    }


def merge_provider(existing: dict, provider: dict) -> dict:
    """Put our provider into a models.json document, keeping everything else in it."""
    merged = dict(existing)
    providers = dict(merged.get("providers") or {})
    providers[PROVIDER_ID] = provider
    merged["providers"] = providers
    return merged
