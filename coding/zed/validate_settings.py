#!/usr/bin/env python3
"""Offline validator for the Zed Token Factory settings fragment."""

from __future__ import annotations

import json
import sys
from pathlib import Path

SETTINGS_PATH = Path(__file__).with_name("settings.json")
PROVIDER_ID = "nebius"
API_KEY_ENV_VAR = "NEBIUS_API_KEY"
BASE_URL = "https://api.tokenfactory.nebius.com/v1"
MODEL_ID = "moonshotai/Kimi-K3"
EXPECTED_CAPABILITIES = {
    "tools": True,
    "images": True,
    "parallel_tool_calls": False,
    "prompt_cache_key": False,
    "chat_completions": True,
    "interleaved_reasoning": True,
    "max_tokens_parameter": False,
}


class ValidationError(ValueError):
    """Raised when the recipe no longer represents the validated Zed contract."""


def generated_api_key_environment_variable(provider_id: str) -> str:
    """Mirror Zed's upper-snake provider-ID credential naming rule."""
    normalized = "".join(
        character if character.isalnum() else "_" for character in provider_id
    )
    return f"{normalized.upper()}_API_KEY"


def contains_secret_like_material(value: object) -> bool:
    if isinstance(value, dict):
        return any(
            key.lower() in {"api_key", "authorization"}
            or contains_secret_like_material(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(contains_secret_like_material(child) for child in value)
    if isinstance(value, str):
        lowered = value.lower()
        return lowered.startswith(("bearer ", "sk-"))
    return False


def load_and_validate(path: Path = SETTINGS_PATH) -> dict:
    raw = path.read_text(encoding="utf-8")
    settings = json.loads(raw)

    if contains_secret_like_material(settings):
        raise ValidationError("settings.json must not contain API key material")

    providers = settings.get("language_models", {}).get("openai_compatible", {})
    if set(providers) != {PROVIDER_ID}:
        raise ValidationError(f"expected exactly one {PROVIDER_ID!r} provider")

    provider = providers[PROVIDER_ID]
    if set(provider) != {"api_url", "available_models"}:
        raise ValidationError("provider must contain only api_url and available_models")
    if provider["api_url"] != BASE_URL:
        raise ValidationError(f"api_url must be {BASE_URL}")

    models = provider["available_models"]
    if not isinstance(models, list) or len(models) != 1:
        raise ValidationError("expected exactly one validated model")
    model = models[0]
    if model.get("name") != MODEL_ID:
        raise ValidationError(f"model name must be {MODEL_ID}")
    if model.get("max_tokens") != 1_000_000:
        raise ValidationError("Kimi K3 max_tokens must be 1000000")
    if model.get("capabilities") != EXPECTED_CAPABILITIES:
        raise ValidationError("model capabilities differ from the validated contract")

    default_model = settings.get("agent", {}).get("default_model", {})
    if default_model != {"provider": PROVIDER_ID, "model": MODEL_ID}:
        raise ValidationError("agent.default_model must select the configured model")

    env_var = generated_api_key_environment_variable(PROVIDER_ID)
    if env_var != API_KEY_ENV_VAR:
        raise ValidationError(f"provider ID must generate {API_KEY_ENV_VAR}")
    return settings


def main() -> int:
    try:
        settings = load_and_validate()
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        print(f"Invalid Zed settings: {error}", file=sys.stderr)
        return 1

    model = settings["agent"]["default_model"]["model"]
    print(
        f"Valid Zed config: {model} via {BASE_URL}/chat/completions; "
        f"key source {API_KEY_ENV_VAR} or Zed keychain"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
