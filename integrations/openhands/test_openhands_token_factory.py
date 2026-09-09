"""Offline tests for the OpenHands Token Factory launcher."""

from __future__ import annotations

import subprocess
from unittest.mock import patch

import pytest

from openhands_token_factory import (
    TOKEN_FACTORY_BASE_URL,
    TokenFactorySettings,
    main,
    openhands_command,
)


def test_required_settings_are_enforced() -> None:
    with pytest.raises(RuntimeError, match="NEBIUS_API_KEY, NEBIUS_MODEL"):
        TokenFactorySettings.from_env({})


def test_token_factory_id_maps_to_litellm_openai_provider() -> None:
    settings = TokenFactorySettings.from_env(
        {
            "NEBIUS_API_KEY": "offline-test-key",
            "NEBIUS_MODEL": "openai/gpt-oss-120b",
        }
    )

    environment = settings.openhands_environment({"PATH": "/test/bin"})

    assert settings.litellm_model == "openai/openai/gpt-oss-120b"
    assert environment == {
        "PATH": "/test/bin",
        "LLM_API_KEY": "offline-test-key",
        "LLM_BASE_URL": TOKEN_FACTORY_BASE_URL,
        "LLM_MODEL": "openai/openai/gpt-oss-120b",
    }


def test_double_provider_prefix_is_rejected() -> None:
    with pytest.raises(RuntimeError, match="do not include OpenHands"):
        TokenFactorySettings.from_env(
            {
                "NEBIUS_API_KEY": "offline-test-key",
                "NEBIUS_MODEL": "openai/openai/gpt-oss-120b",
            }
        )


def test_launcher_uses_authoritative_environment_overrides() -> None:
    source = {
        "NEBIUS_API_KEY": "offline-test-key",
        "NEBIUS_MODEL": "openai/gpt-oss-120b",
        "PATH": "/test/bin",
    }
    completed = subprocess.CompletedProcess([], 0)

    with (
        patch.dict("os.environ", source, clear=True),
        patch("shutil.which", return_value="/test/bin/openhands"),
        patch("subprocess.run", return_value=completed) as run,
    ):
        assert main(["--headless", "-t", "print the repository name"]) == 0

    assert openhands_command(["--headless"]) == [
        "openhands",
        "--override-with-envs",
        "--headless",
    ]
    (command,) = run.call_args.args
    assert command == [
        "openhands",
        "--override-with-envs",
        "--headless",
        "-t",
        "print the repository name",
    ]
    launch_env = run.call_args.kwargs["env"]
    assert launch_env["LLM_BASE_URL"] == TOKEN_FACTORY_BASE_URL
    assert launch_env["LLM_MODEL"] == "openai/openai/gpt-oss-120b"
    assert run.call_args.kwargs["check"] is False
