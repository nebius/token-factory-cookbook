from __future__ import annotations

import copy
import json
from pathlib import Path

from validate_provider import CANONICAL_API, load_catalog, validate

FIXTURE = Path(__file__).parent / "fixtures" / "models-dev.json"
MODEL = "moonshotai/Kimi-K2.7-Code"


def catalog() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_fixture_matches_provider_and_active_model_contract() -> None:
    assert validate(load_catalog(str(FIXTURE)), MODEL) == []


def test_rejects_noncanonical_endpoint() -> None:
    data = catalog()
    data["nebius"]["api"] = "https://api.studio.nebius.ai/v1"
    assert validate(data, MODEL) == [
        (f"nebius.api must be {CANONICAL_API!r}, got 'https://api.studio.nebius.ai/v1'")
    ]


def test_rejects_responses_client_for_chat_catalog_route() -> None:
    data = catalog()
    data["nebius"]["npm"] = "@ai-sdk/openai"
    assert "nebius.npm must be '@ai-sdk/openai-compatible'" in validate(data, MODEL)[0]


def test_rejects_missing_api_key_contract() -> None:
    data = catalog()
    data["nebius"]["env"] = []
    assert validate(data, MODEL) == ["nebius.env must include NEBIUS_API_KEY"]


def test_rejects_deprecated_or_missing_model() -> None:
    data = catalog()
    errors = validate(data, "moonshotai/Kimi-K2.5")
    assert errors == ["model 'moonshotai/Kimi-K2.5' is deprecated"]
    assert validate(data, "missing/model") == [
        "model 'missing/model' is not present under the nebius provider"
    ]


def test_rejects_model_without_tools_or_text_output() -> None:
    data = copy.deepcopy(catalog())
    model = data["nebius"]["models"][MODEL]
    model["tool_call"] = False
    model["modalities"]["output"] = []
    assert validate(data, MODEL) == [
        f"model {MODEL!r} is not marked tool-call capable",
        f"model {MODEL!r} does not declare text output",
    ]
