import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app  # noqa: E402


def _message(content="", tool_calls=None, reasoning=None):
    message = SimpleNamespace(content=content, tool_calls=tool_calls, model_extra={})
    if reasoning is not None:
        message.model_extra["reasoning_content"] = reasoning
    return message


def _response(message, prompt=10, completion=5, reasoning=2):
    usage = SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning),
    )
    return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        return self.responses.pop(0)


def _tool_call(call_id, name, value, unit="thousand"):
    return SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(
            name="record_metric",
            arguments=json.dumps({"name": name, "value": value, "unit": unit}),
        ),
    )


def test_run_records_metrics_and_echoes_reasoning(tmp_path):
    chart = tmp_path / "chart.png"
    chart.write_bytes(b"\x89PNG fake")
    first = _message(tool_calls=[_tool_call("call_1", "Jan", 12), _tool_call("call_2", "Feb", 15)], reasoning="look at bars")
    second = _message(content="Feb is largest and Jan is smallest.", reasoning="done")
    client = FakeClient([_response(first), _response(second, prompt=20, completion=7, reasoning=3)])

    answer, recorded, usage = app.run(client, "test-model", str(chart), reasoning_effort="low")

    assert answer == "Feb is largest and Jan is smallest."
    assert [m["name"] for m in recorded] == ["Jan", "Feb"]
    assert usage == {"prompt_tokens": 30, "completion_tokens": 12, "reasoning_tokens": 5}

    second_request = client.requests[1]
    assert second_request["extra_body"] == {"reasoning_effort": "low"}
    assistant_turn = second_request["messages"][1]
    assert assistant_turn["reasoning_content"] == "look at bars"
    assert [c["id"] for c in assistant_turn["tool_calls"]] == ["call_1", "call_2"]
    tool_turns = second_request["messages"][2:]
    assert [t["tool_call_id"] for t in tool_turns] == ["call_1", "call_2"]
    assert all(t["role"] == "tool" for t in tool_turns)
    first_request = client.requests[0]
    image_part = first_request["messages"][0]["content"][1]
    assert image_part["image_url"]["url"].startswith("data:image/png;base64,")


def test_run_passes_public_urls_through():
    client = FakeClient([_response(_message(content="ok"))])
    app.run(client, "m", "https://example.com/chart.png")
    image_part = client.requests[0]["messages"][0]["content"][1]
    assert image_part["image_url"]["url"] == "https://example.com/chart.png"


def test_unknown_tool_is_reported_back_to_the_model():
    bad = SimpleNamespace(id="call_x", function=SimpleNamespace(name="bash", arguments="{}"))
    client = FakeClient([_response(_message(tool_calls=[bad])), _response(_message(content="fine"))])
    answer, recorded, _ = app.run(client, "m", "https://example.com/c.png")
    assert answer == "fine"
    assert recorded == []
    tool_turn = client.requests[1]["messages"][-1]
    assert tool_turn["tool_call_id"] == "call_x"
    assert "unknown tool" in tool_turn["content"]


def test_run_stops_after_max_rounds():
    looping = [_response(_message(tool_calls=[_tool_call("c", "Jan", 1)])) for _ in range(3)]
    client = FakeClient(looping)
    with pytest.raises(RuntimeError):
        app.run(client, "m", "https://example.com/c.png", max_rounds=3)


def test_main_prints_marker_and_usage(monkeypatch, capsys):
    monkeypatch.setenv("NEBIUS_API_KEY", "test")
    monkeypatch.setenv("CHART_IMAGE", "https://example.com/c.png")
    client = FakeClient([_response(_message(content="Mar is largest."), prompt=100, completion=40, reasoning=30)])
    assert app.main(client=client) == 0
    out = capsys.readouterr().out
    assert "Kimi response: Mar is largest." in out
    assert "usage: prompt=100 completion=40 reasoning=30" in out
