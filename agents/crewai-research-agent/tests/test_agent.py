from __future__ import annotations

import json

import httpx
from openai import OpenAI

from agent import (
    TOKEN_FACTORY_BASE_URL,
    TOKEN_FACTORY_MODEL,
    build_crew,
    build_llm,
    lookup_topic_brief,
)


def test_llm_uses_native_custom_openai_chat_configuration() -> None:
    llm = build_llm("test-key")

    assert llm.__class__.__name__ == "OpenAICompletion"
    assert llm.provider == "openai"
    assert llm.model == TOKEN_FACTORY_MODEL
    assert llm.base_url == TOKEN_FACTORY_BASE_URL
    assert llm.custom_openai is True
    assert llm.api == "completions"
    assert llm.is_litellm is False


def test_local_tool_and_two_agent_crew_are_wired() -> None:
    assert "validate tool inputs" in lookup_topic_brief.run("tool-using agents")
    assert "evidence gap" in lookup_topic_brief.run("unknown subject").lower()

    llm = build_llm("test-key")
    crew = build_crew(llm)

    assert len(crew.agents) == 2
    assert len(crew.tasks) == 2
    assert crew.agents[0].llm is llm
    assert crew.agents[1].llm is llm
    assert [tool.name for tool in crew.agents[0].tools] == [
        "Look up a technology brief"
    ]
    assert crew.agents[1].tools == []


def test_chat_completion_request_shape_without_network() -> None:
    captured: dict[str, object] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl_test",
                "object": "chat.completion",
                "created": 1,
                "model": TOKEN_FACTORY_MODEL,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "Mock reply"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 3,
                    "completion_tokens": 2,
                    "total_tokens": 5,
                },
            },
        )

    llm = build_llm("test-key")
    mock_http = httpx.Client(transport=httpx.MockTransport(respond))
    llm._client = OpenAI(
        api_key="test-key",
        base_url=TOKEN_FACTORY_BASE_URL,
        http_client=mock_http,
    )

    assert llm.call("Say hello") == "Mock reply"
    assert captured == {
        "method": "POST",
        "url": f"{TOKEN_FACTORY_BASE_URL}/chat/completions",
        "authorization": "Bearer test-key",
        "body": {
            "messages": [{"role": "user", "content": "Say hello"}],
            "model": TOKEN_FACTORY_MODEL,
            "temperature": 0.2,
        },
    }
