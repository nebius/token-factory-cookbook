import json

import pytest
import validate_settings as validator


def write_settings(tmp_path, settings: dict) -> None:
    (tmp_path / "settings.json").write_text(json.dumps(settings), encoding="utf-8")


def test_recipe_matches_validated_zed_contract() -> None:
    settings = validator.load_and_validate()
    provider = settings["language_models"]["openai_compatible"][validator.PROVIDER_ID]
    model = provider["available_models"][0]

    assert provider["api_url"] == validator.BASE_URL
    assert model["name"] == validator.MODEL_ID
    assert model["capabilities"]["chat_completions"] is True
    assert model["capabilities"]["interleaved_reasoning"] is True
    assert model["capabilities"]["max_tokens_parameter"] is False


def test_provider_id_maps_to_nebius_api_key() -> None:
    assert (
        validator.generated_api_key_environment_variable(validator.PROVIDER_ID)
        == "NEBIUS_API_KEY"
    )
    assert (
        validator.generated_api_key_environment_variable("my-gateway")
        == "MY_GATEWAY_API_KEY"
    )


def test_responses_mode_is_rejected(tmp_path) -> None:
    settings = validator.load_and_validate()
    model = settings["language_models"]["openai_compatible"][validator.PROVIDER_ID][
        "available_models"
    ][0]
    model["capabilities"]["chat_completions"] = False
    write_settings(tmp_path, settings)

    with pytest.raises(validator.ValidationError, match="capabilities"):
        validator.load_and_validate(tmp_path / "settings.json")


def test_wrong_model_is_rejected(tmp_path) -> None:
    settings = validator.load_and_validate()
    settings["language_models"]["openai_compatible"][validator.PROVIDER_ID][
        "available_models"
    ][0]["name"] = "moonshotai/Kimi-K2.5"
    write_settings(tmp_path, settings)

    with pytest.raises(validator.ValidationError, match="model name"):
        validator.load_and_validate(tmp_path / "settings.json")


def test_secret_like_field_is_rejected(tmp_path) -> None:
    settings = validator.load_and_validate()
    settings["language_models"]["openai_compatible"][validator.PROVIDER_ID][
        "api_key"
    ] = "secret"
    write_settings(tmp_path, settings)

    with pytest.raises(validator.ValidationError, match="API key material"):
        validator.load_and_validate(tmp_path / "settings.json")
