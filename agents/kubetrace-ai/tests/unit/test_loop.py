"""The agent loop's control flow, with a scripted model and the real tool dispatcher."""
import json
import threading
from pathlib import Path

from kubetrace_agent.llm import FixtureModel, ModelError, ModelResponse, ToolCall, fixture_call
from kubetrace_agent.loop import Agent, Incident, Limits, Verification
from kubetrace_agent.redact import Redactor
from kubetrace_agent.settings import Settings
from kubetrace_agent.tools import ToolContext

INCIDENT = Incident("t", "title", "desc", "ns")


def make(script, verify=lambda o: Verification(True, [], ""), limits=None, cancel=None):
    events = []
    ctx = ToolContext(settings=Settings(), namespace="ns", api=None, executor=None, workspace=None, runner=None, builder=None,
                      redactor=Redactor(), run_dir=Path("/tmp"), emit=lambda t, p: events.append((t, p)), set_state=lambda s: None)
    agent = Agent(script if not isinstance(script, list) else FixtureModel(script), ctx, INCIDENT,
                  limits or Limits(max_steps=10, max_seconds=60, max_tokens=10_000, max_output_chars=2000, verification_retries=1),
                  Redactor(), verify, cancel or threading.Event(), emit=lambda t, p: events.append((t, p)), set_state=lambda s: None)
    return agent, events


FINISH = fixture_call("finish", {"outcome": "resolved", "root_cause": "x", "summary": "y"})
ESCALATE = fixture_call("finish", {"outcome": "escalate", "root_cause": "payment gateway down", "summary": "out of scope"})


def test_unknown_tools_and_bad_arguments_come_back_as_errors_the_model_can_see():
    agent, events = make([fixture_call("no_such_tool", {}), fixture_call("note", {"kind": "guess", "text": "x"}), FINISH])
    result = agent.run()
    results = [p for t, p in events if t == "tool_result"]
    assert not results[0]["ok"] and "unknown tool" in results[0]["output"]
    assert not results[1]["ok"] and "invalid arguments" in results[1]["output"]
    assert result.final_state == "resolved"


def test_failed_verification_gives_one_retry_then_unresolved():
    agent, events = make([FINISH, FINISH, FINISH], verify=lambda o: Verification(False, [{"name": "c", "ok": False}], "still broken"))
    result = agent.run()
    assert result.final_state == "unresolved" and result.first_attempt_success is False
    assert len(result.verifications) == 2 and any(t == "retry" for t, _ in events)


def test_success_on_the_retry_is_eventual_not_first_attempt():
    verdicts = iter([False, True])
    agent, _ = make([FINISH, FINISH], verify=lambda o: Verification(next(verdicts), [], "x"))
    result = agent.run()
    assert result.final_state == "resolved" and result.first_attempt_success is False and result.eventual_success


def test_a_confirmed_escalation_is_escalated_and_an_unconfirmed_one_is_unresolved():
    agent, _ = make([ESCALATE], verify=lambda o: Verification(True, [], ""))
    assert agent.run().final_state == "escalated"
    agent, _ = make([ESCALATE], verify=lambda o: Verification(False, [], ""))
    assert agent.run().final_state == "unresolved"


def test_step_limit_ends_the_run():
    agent, _ = make([fixture_call("note", {"kind": "observation", "text": "x"})] * 5,
                    limits=Limits(max_steps=3, max_seconds=60, max_tokens=10_000, max_output_chars=2000, verification_retries=0))
    result = agent.run()
    assert result.final_state == "unresolved" and "step limit" in result.reason


def test_cancellation_stops_the_run():
    cancel = threading.Event()
    cancel.set()
    agent, _ = make([FINISH], cancel=cancel)
    assert agent.run().final_state == "cancelled"


def test_token_budget_ends_the_run():
    class Hungry:
        provider, model = "test", "hungry"
        def generation_settings(self): return {}
        def chat(self, messages, tools):
            return ModelResponse("", [ToolCall(f"c{len(messages)}", "note", json.dumps({"kind": "observation", "text": "x"}))],
                                 "tool_calls", {"prompt_tokens": 6000, "completion_tokens": 10, "total_tokens": 6010}, 0.1, "hungry")
    agent, _ = make(Hungry())
    result = agent.run()
    assert result.final_state == "unresolved" and "token budget" in result.reason
    assert result.metrics["token_usage"] == "reported by provider"


def test_model_failure_blocks_without_switching_models():
    class Down:
        provider, model = "test", "down"
        def generation_settings(self): return {}
        def chat(self, messages, tools): raise ModelError("503: overloaded")
    agent, events = make(Down())
    result = agent.run()
    assert result.final_state == "blocked" and "overloaded" in result.reason
    assert all(p.get("model", "down") == "down" for t, p in events if t == "model_call")


def test_tool_output_is_redacted_before_the_model_sees_it(monkeypatch):
    from kubetrace_agent import tools
    secret = "sk-supersecret-0123456789abcdef"
    leaky = tools.Tool("list_files", tools.ListFiles, lambda ctx, a: {"files": [{"path": ".env", "content": f"KEY={secret}"}],
                                                                      "log": f"Authorization: Bearer {secret}"}, "read")
    monkeypatch.setitem(tools.TOOLS_BY_NAME, "list_files", leaky)
    seen = []

    class Recorder(FixtureModel):
        def chat(self, messages, tools_):
            seen.extend(m.get("content", "") for m in messages if m.get("role") == "tool")
            return super().chat(messages, tools_)

    agent, events = make(Recorder([fixture_call("list_files", {}), FINISH]))
    agent.redactor = Redactor([secret])
    agent.run()
    assert seen and all(secret not in text for text in seen)            # what the model was sent
    assert secret not in json.dumps([p for t, p in events if t == "tool_result"])  # what the timeline stores


def test_a_hanging_tool_is_abandoned_and_reported(monkeypatch):
    import time as time_module
    from kubetrace_agent import tools
    monkeypatch.setattr(tools, "DEFAULT_TOOL_TIMEOUT_S", 1)
    slow = tools.Tool("list_files", tools.ListFiles, lambda ctx, a: time_module.sleep(5) or {}, "read")
    monkeypatch.setitem(tools.TOOLS_BY_NAME, "list_files", slow)
    agent, events = make([fixture_call("list_files", {}), FINISH])
    started = time_module.monotonic()
    assert agent.run().final_state == "resolved"
    assert time_module.monotonic() - started < 4
    result = [p for t, p in events if t == "tool_result"][0]
    assert not result["ok"] and "did not finish" in result["output"]


def test_unexpected_tool_exceptions_become_tool_errors(monkeypatch):
    from kubetrace_agent import tools
    def boom(ctx, a):
        raise ConnectionError("connection reset by peer")
    monkeypatch.setitem(tools.TOOLS_BY_NAME, "list_files", tools.Tool("list_files", tools.ListFiles, boom, "read"))
    agent, events = make([fixture_call("list_files", {}), FINISH])
    assert agent.run().final_state == "resolved"
    assert "ConnectionError" in [p for t, p in events if t == "tool_result"][0]["output"]


def test_repeating_an_identical_call_gets_a_notice():
    agent, events = make([fixture_call("note", {"kind": "observation", "text": "same"})] * 3 + [FINISH])
    agent.run()
    outputs = [p["output"] for t, p in events if t == "tool_result"]
    assert "repeat_notice" not in outputs[1] and "repeat_notice" in outputs[2]
