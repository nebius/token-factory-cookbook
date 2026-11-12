"""Thin Kimi client on Nebius Token Factory (OpenAI-compatible API).

Kimi K3.1 Pro is preferred. If the key can't use it yet, the app falls back to Kimi K3 and says so.
"""

from __future__ import annotations

from openai import OpenAI

NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
PREFERRED_MODEL = "moonshotai/Kimi-K3.1-Pro"
FALLBACK_MODELS = ["moonshotai/Kimi-K3"]
LABELS = {"moonshotai/Kimi-K3.1-Pro": "Kimi K3.1 Pro", "moonshotai/Kimi-K3": "Kimi K3"}


def get_client(api_key: str) -> OpenAI:
    if not isinstance(api_key, str) or not api_key.strip():
        raise RuntimeError("Set NEBIUS_API_KEY in .streamlit/secrets.toml.")
    return OpenAI(base_url=NEBIUS_BASE_URL, api_key=api_key.strip(), timeout=120.0, max_retries=2)


def pick_model(client: OpenAI, preferred_model: str = PREFERRED_MODEL) -> str:
    """The preferred model if this key lists it, else the first fallback it lists."""
    if not isinstance(preferred_model, str) or not preferred_model.strip():
        raise RuntimeError("KIMI_MODEL in .streamlit/secrets.toml must be a nonempty string.")
    preferred_model = preferred_model.strip()
    try:
        ids = {m.id for m in client.models.list().data}
    except Exception:  # listing can fail on network or permissions; let the call decide
        return preferred_model
    for model in [preferred_model, *FALLBACK_MODELS]:
        if model in ids:
            return model
    return preferred_model


def label(model_id: str) -> str:
    return LABELS.get(model_id, model_id.split("/")[-1])
