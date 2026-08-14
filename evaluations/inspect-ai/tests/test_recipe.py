"""Offline tests for the Token Factory Inspect recipe."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from inspect_ai import eval
from inspect_ai.model import Model, ModelOutput, get_model

from settings import TOKEN_FACTORY_BASE_URL, TokenFactorySettings
from smoke_eval import token_factory_smoke


def test_settings_require_both_token_factory_values() -> None:
    with pytest.raises(RuntimeError, match="NEBIUS_API_KEY, NEBIUS_MODEL"):
        TokenFactorySettings.from_env({})


def test_settings_select_generic_openai_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    settings = TokenFactorySettings.from_env(
        {
            "NEBIUS_API_KEY": "test-key",
            "NEBIUS_MODEL": "openai/gpt-oss-120b",
        }
    )

    settings.configure_openai_provider()

    assert settings.inspect_model == "openai/openai/gpt-oss-120b"
    assert TOKEN_FACTORY_BASE_URL == "https://api.tokenfactory.nebius.com/v1"
    assert os.environ["OPENAI_API_KEY"] == "test-key"
    assert os.environ["OPENAI_BASE_URL"] == TOKEN_FACTORY_BASE_URL


def test_task_runs_and_scores_offline(tmp_path: Path) -> None:
    def deterministic_output(input, tools, tool_choice, config):
        prompt = input[-1].text
        answer = "42" if "19 + 23" in prompt else "token factory"
        return ModelOutput.from_content("mockllm/model", answer)

    model = get_model("mockllm/model", custom_outputs=deterministic_output)
    logs = eval(
        token_factory_smoke(),
        model=model,
        log_dir=str(tmp_path),
        display="none",
    )

    assert len(logs) == 1
    assert logs[0].status == "success"
    assert logs[0].results is not None
    assert logs[0].results.scores[0].metrics["accuracy"].value == 1.0


def test_openai_provider_constructs_without_a_custom_adapter() -> None:
    settings = TokenFactorySettings("offline-test-key", "openai/gpt-oss-120b")
    settings.configure_openai_provider()

    model: Model = get_model(settings.inspect_model, responses_api=False)

    assert model.api.model_name == "openai/gpt-oss-120b"
    assert str(model.api.client.base_url).rstrip("/") == TOKEN_FACTORY_BASE_URL
    assert model.api.responses_api is False


def test_recipe_keeps_responses_api_disabled() -> None:
    runner = Path(__file__).parents[1].joinpath("run_eval.py").read_text()
    assert '"responses_api": False' in runner
    assert "responses_api=True" not in runner
