"""Thin Kimi client on Nebius Token Factory (OpenAI-compatible API).

Kimi K3.1 Pro is preferred. If the key can't use it yet, the app falls back to Kimi K3 and says so.
"""

from __future__ import annotations

import os

from openai import OpenAI

NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
PREFERRED_MODEL = os.getenv("KIMI_MODEL", "moonshotai/Kimi-K3.1-Pro")
FALLBACK_MODELS = ["moonshotai/Kimi-K3"]
LABELS = {"moonshotai/Kimi-K3.1-Pro": "Kimi K3.1 Pro", "moonshotai/Kimi-K3": "Kimi K3"}


def get_client() -> OpenAI:
    api_key = os.getenv("NEBIUS_API_KEY")
    if not api_key:
        raise RuntimeError("NEBIUS_API_KEY is not set. Copy env.example to .env and add your key.")
    return OpenAI(base_url=NEBIUS_BASE_URL, api_key=api_key, timeout=120.0, max_retries=2)


def pick_model(client: OpenAI) -> str:
    """The preferred model if this key lists it, else the first fallback it lists."""
    try:
        ids = {m.id for m in client.models.list().data}
    except Exception:  # listing can fail on network or permissions; let the call decide
        return PREFERRED_MODEL
    for model in [PREFERRED_MODEL, *FALLBACK_MODELS]:
        if model in ids:
            return model
    return PREFERRED_MODEL


def label(model_id: str) -> str:
    return LABELS.get(model_id, model_id.split("/")[-1])
