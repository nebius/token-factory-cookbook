from pathlib import Path

import kimi_token_factory as recipe
import pytest


def valid_environment() -> dict[str, str]:
    return {
        "NEBIUS_API_KEY": "test-only-key",
        "NEBIUS_MODEL": "moonshotai/Kimi-K3",
    }


def test_template_selects_chat_completions_only() -> None:
    template, config = recipe.load_and_validate_template()
    provider = config["providers"][recipe.PROVIDER_KEY]

    assert provider["type"] == "openai_legacy"
    assert provider["base_url"] == recipe.BASE_URL
    assert "openai_responses" not in template
    assert "/responses" not in template


def test_template_does_not_contain_a_secret() -> None:
    template, config = recipe.load_and_validate_template()

    assert "NEBIUS_API_KEY" not in template
    assert config["providers"][recipe.PROVIDER_KEY]["api_key"] == (
        "overridden-by-OPENAI_API_KEY"
    )


def test_required_environment() -> None:
    assert recipe.require_environment(valid_environment()) == (
        "test-only-key",
        "moonshotai/Kimi-K3",
    )

    with pytest.raises(recipe.ConfigurationError, match="NEBIUS_API_KEY, NEBIUS_MODEL"):
        recipe.require_environment({})


@pytest.mark.parametrize("model", ["Kimi-K3", "moonshotai/Kimi-K2.5"])
def test_model_is_pinned_to_validated_current_model(model: str) -> None:
    environment = valid_environment()
    environment["NEBIUS_MODEL"] = model

    with pytest.raises(recipe.ConfigurationError, match="must be moonshotai/Kimi-K3"):
        recipe.require_environment(environment)


def test_rendered_config_contains_runtime_model_not_api_key() -> None:
    rendered = recipe.render_config("moonshotai/Kimi-K3")

    assert recipe.MODEL_PLACEHOLDER not in rendered
    assert 'model = "moonshotai/Kimi-K3"' in rendered
    assert "test-only-key" not in rendered


def test_command_uses_isolated_config() -> None:
    config_path = Path("/tmp/kimi-token-factory/config.toml")

    assert recipe.build_command(config_path, ["--print", "hello"]) == [
        "kimi",
        "--config-file",
        str(config_path),
        "--print",
        "hello",
    ]


def test_check_does_not_require_installed_cli(monkeypatch, capsys) -> None:
    for name, value in valid_environment().items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(recipe.shutil, "which", lambda _: None)

    assert recipe.main(["--check"]) == 0
    assert "via Chat Completions" in capsys.readouterr().out
