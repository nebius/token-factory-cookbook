"""Live Nebius Token Factory model catalog helpers (standard library only).

Model IDs, context windows and prices change often, so nothing in this recipe
hardcodes them. Everything is read from GET /v1/models?verbose=true at run time.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1"


def base_url() -> str:
    return os.environ.get("NEBIUS_BASE_URL", "").strip().rstrip("/") or DEFAULT_BASE_URL


def api_key() -> str:
    key = os.environ.get("NEBIUS_API_KEY", "").strip()
    if not key:
        sys.exit("NEBIUS_API_KEY is not set. Run `cp env.example .env` and fill it in.")
    return key


def fetch_models() -> list[dict]:
    """Return the live catalog. Exits with a readable message on failure."""
    req = urllib.request.Request(
        f"{base_url()}/models?verbose=true",
        headers={"Authorization": f"Bearer {api_key()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
    except urllib.error.HTTPError as exc:
        # /v1/models can answer 500 as text/plain, so do not assume JSON here.
        sys.exit(f"GET /v1/models failed: HTTP {exc.code} {exc.read().decode()[:200]}")
    except urllib.error.URLError as exc:
        sys.exit(f"GET /v1/models failed: {exc.reason}")
    return json.loads(body)["data"]


def is_agent_capable(model: dict) -> bool:
    """Claude Code is all tool calls, so only text models that advertise tools qualify."""
    features = model.get("supported_features") or []
    modality = (model.get("architecture") or {}).get("modality", "")
    return "tools" in features and modality.endswith("->text")


def price_per_token(model: dict, field: str) -> float:
    return float((model.get("pricing") or {}).get(field) or 0)
