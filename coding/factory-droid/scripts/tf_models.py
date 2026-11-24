"""Live Nebius Token Factory model catalog helpers (standard library only).

Model IDs and context windows change often, so nothing in this recipe hardcodes
them. Everything is read from GET /v1/models?verbose=true at run time.
Settings come from the recipe's .env file, or from the environment without one.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def load_env_file(path: Path = ENV_FILE) -> None:
    """Read KEY=VALUE lines from the recipe's .env into the environment.

    The file wins over values already exported in the shell, so editing .env
    takes effect on the next run without loading it again. Lines left blank in
    the file do not erase a value the shell provides.
    """
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


def base_url() -> str:
    return os.environ.get("NEBIUS_BASE_URL", "").strip().rstrip("/") or DEFAULT_BASE_URL


def api_key() -> str:
    key = os.environ.get("NEBIUS_API_KEY", "").strip()
    if not key:
        sys.exit("NEBIUS_API_KEY is not set. Run `cp env.example .env` and fill it in, then save the file.")
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


def modality(model: dict) -> str:
    return (model.get("architecture") or {}).get("modality", "")


def is_agent_capable(model: dict) -> bool:
    """Droid is all tool calls, so only text models that advertise tools qualify."""
    features = model.get("supported_features") or []
    return "tools" in features and modality(model).endswith("->text")


def accepts_images(model: dict) -> bool:
    return "image" in modality(model).split("->")[0]


def requested_models() -> list[str]:
    """Model IDs from TF_MODELS, comma separated, in order, without duplicates."""
    seen: list[str] = []
    for raw in os.environ.get("TF_MODELS", "").split(","):
        model_id = raw.strip()
        if model_id and model_id not in seen:
            seen.append(model_id)
    return seen
