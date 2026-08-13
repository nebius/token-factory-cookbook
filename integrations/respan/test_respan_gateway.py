import json

import httpx
import pytest
import respan_gateway as recipe


def environment(**overrides: str) -> dict[str, str]:
    values = {
        "RESPAN_API_KEY": "respan-test-key",
        "RESPAN_MODEL": recipe.SUPPORTED_MODEL,
        "RESPAN_LOG_CONTENT": "false",
    }
    values.update(overrides)
    return values


def test_reference_maps_custom_provider_to_token_factory() -> None:
    config = recipe.load_and_validate_reference()

    assert config["provider"]["base_url"] == recipe.TOKEN_FACTORY_BASE_URL
    assert config["provider"]["api_key_source"].startswith("NEBIUS_API_KEY")
    assert config["model"] == {
        "id": recipe.SUPPORTED_MODEL,
        "provider_id": recipe.PROVIDER_ID,
    }
    assert config["application"]["request_path"] == "/chat/completions"


def test_required_environment_and_privacy_default() -> None:
    settings = recipe.Settings.from_environment(
        {
            "RESPAN_API_KEY": "respan-test-key",
            "RESPAN_MODEL": recipe.SUPPORTED_MODEL,
        }
    )
    assert settings.log_content is False

    with pytest.raises(recipe.ConfigurationError, match="RESPAN_API_KEY, RESPAN_MODEL"):
        recipe.Settings.from_environment({})


def test_model_is_pinned_to_validated_registration() -> None:
    with pytest.raises(recipe.ConfigurationError, match=recipe.SUPPORTED_MODEL):
        recipe.Settings.from_environment(
            environment(RESPAN_MODEL="openai/gpt-oss-120b")
        )


def test_invalid_content_setting_is_rejected() -> None:
    with pytest.raises(recipe.ConfigurationError, match="must be true or false"):
        recipe.Settings.from_environment(environment(RESPAN_LOG_CONTENT="sometimes"))


@pytest.mark.parametrize(
    ("log_content", "expected_disable_log"),
    [("false", True), ("true", False)],
)
def test_openai_client_uses_chat_completions_only(
    log_content: str, expected_disable_log: bool
) -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["authorization"] = request.headers["authorization"]
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 0,
                "model": recipe.SUPPORTED_MODEL,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            },
        )

    settings = recipe.Settings.from_environment(
        environment(RESPAN_LOG_CONTENT=log_content)
    )
    with httpx.Client(transport=httpx.MockTransport(handler)) as transport_client:
        client = recipe.create_client(settings, http_client=transport_client)
        assert recipe.create_chat_completion(client, settings, "hello") == "ok"

    assert captured["path"] == "/api/chat/completions"
    assert captured["authorization"] == "Bearer respan-test-key"
    assert captured["body"]["model"] == recipe.SUPPORTED_MODEL
    assert captured["body"]["messages"] == [{"role": "user", "content": "hello"}]
    assert captured["body"]["disable_log"] is expected_disable_log
    assert captured["body"]["metadata"]["provider"] == recipe.PROVIDER_ID
