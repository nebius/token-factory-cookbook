"""Malformed model output must remain recoverable through the agent and UI."""

import copy
import json
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from streamlit.testing.v1 import AppTest

RECIPE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RECIPE))

import agent
import event
import kimi
import tools

NON_OBJECT_JSON = ("[]", '[["booth_id", "radar"]]', "null", '"radar"', '""', "42", "true", "false")


def tool_message(name, arguments, call_id="call_1"):
    return SimpleNamespace(content="", tool_calls=[SimpleNamespace(
        id=call_id, function=SimpleNamespace(name=name, arguments=arguments)
    )])


def scripted_client(messages):
    requests = []
    script = iter(messages)

    def create(**kwargs):
        requests.append(copy.deepcopy(kwargs))
        return SimpleNamespace(choices=[SimpleNamespace(message=next(script))])

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))), requests


class ToolArgumentTest(unittest.TestCase):
    def test_non_object_json_never_dispatches_a_tool(self):
        for name in tools.FUNCS:
            for raw in NON_OBJECT_JSON:
                with self.subTest(tool=name, arguments=raw):
                    ev = event.synthetic()
                    handler = Mock()
                    with patch.dict(tools.FUNCS, {name: handler}):
                        result = json.loads(tools.call(ev, name, raw))
                    self.assertIn("error", result)
                    handler.assert_not_called()
                    self.assertEqual(ev.drafts, [])

    def test_python_non_objects_are_not_coerced_into_arguments(self):
        for args in ([], [["booth_id", "radar"]], 0, False, 1.5):
            with self.subTest(arguments=args):
                result = json.loads(tools.call(event.synthetic(), "get_booth_health", args))
                self.assertIn("error", result)

    def test_absent_arguments_still_work_for_no_argument_tools(self):
        for args in (None, "", {}, "{}"):
            with self.subTest(arguments=args):
                result = json.loads(tools.call(event.synthetic(), "get_checkin_stats", args))
                self.assertEqual(result["checked_in"], 100)

    def test_invalid_json_and_numeric_overflow_return_errors(self):
        deeply_nested = '{"unused":' + "[" * 1100 + "0" + "]" * 1100 + "}"
        for args in ("{not json", deeply_nested, '{"booth_id":"radar","minutes":1e309}', '{"unused":NaN}'):
            with self.subTest(arguments=args):
                result = json.loads(tools.call(event.synthetic(), "get_booth_timeline", args))
                self.assertIn("error", result)


class AgentArgumentTest(unittest.TestCase):
    def test_agent_recovers_from_bad_arguments_and_preserves_call_ids(self):
        for name in ("get_booth_health", "unknown_tool"):
            for raw in (*NON_OBJECT_JSON, "{not json", '{"unused":NaN}'):
                with self.subTest(tool=name, arguments=raw):
                    client, requests = scripted_client([
                        tool_message(name, raw, "bad_call"),
                        tool_message("get_checkin_stats", "{}", "good_call"),
                        SimpleNamespace(content="100 attendees checked in.", tool_calls=[]),
                    ])
                    ev = event.synthetic()
                    answer = agent.ask(client, "fixture-model", ev, "Check the event")
                    self.assertFalse(answer.stopped_early)
                    self.assertEqual(answer.text, "100 attendees checked in.")
                    self.assertEqual(len(requests), 3)
                    for request in requests:
                        for message in request["messages"]:
                            for call in message.get("tool_calls", []):
                                self.assertIsInstance(json.loads(call["function"]["arguments"]), dict)
                                self.assertNotIn("NaN", call["function"]["arguments"])
                    error_reply = requests[1]["messages"][-1]
                    self.assertEqual(error_reply["tool_call_id"], "bad_call")
                    self.assertIn("error", json.loads(error_reply["content"]))
                    self.assertEqual(requests[2]["messages"][-1]["tool_call_id"], "good_call")
                    self.assertEqual(answer.steps[1].result["checked_in"], 100)
                    self.assertTrue(all(isinstance(step.arguments, dict) for step in answer.steps))
                    self.assertEqual(answer.steps[0].arguments["raw"], raw)
                    self.assertEqual(ev.drafts, [])

    def test_repeated_invalid_arguments_respect_round_limit(self):
        client, requests = scripted_client([
            tool_message("get_booth_health", "null", f"call_{i}") for i in range(agent.MAX_STEPS)
        ])
        answer = agent.ask(client, "fixture-model", event.synthetic(), "Check the event")
        self.assertTrue(answer.stopped_early)
        self.assertEqual(len(requests), agent.MAX_STEPS)
        self.assertTrue(all("error" in step.result for step in answer.steps))

    def test_mixed_tool_batch_keeps_every_result_paired_with_its_call(self):
        batch = SimpleNamespace(content="", tool_calls=[
            tool_message("draft_sponsor_message", "[]", "bad_call").tool_calls[0],
            tool_message("get_checkin_stats", "{}", "good_call").tool_calls[0],
        ])
        client, requests = scripted_client([
            batch, SimpleNamespace(content="100 attendees checked in.", tool_calls=[]),
        ])
        ev = event.synthetic()
        answer = agent.ask(client, "fixture-model", ev, "Check the event and draft a note")
        assistant, bad_reply, good_reply = requests[1]["messages"][-3:]
        self.assertEqual([call["id"] for call in assistant["tool_calls"]], ["bad_call", "good_call"])
        self.assertEqual(bad_reply["tool_call_id"], "bad_call")
        self.assertIn("error", json.loads(bad_reply["content"]))
        self.assertEqual(good_reply["tool_call_id"], "good_call")
        self.assertEqual(json.loads(good_reply["content"])["checked_in"], 100)
        self.assertFalse(answer.stopped_early)
        self.assertEqual(ev.drafts, [])


class ToolArgumentUITest(unittest.TestCase):
    def test_recovered_errors_render_and_survive_reruns(self):
        for name, raw in (("get_booth_health", "[]"), ("unknown_tool", "[]"), ("unknown_tool", "null")):
            with self.subTest(tool=name, arguments=raw):
                app = AppTest.from_file(str(RECIPE / "app.py"), default_timeout=20)
                app.secrets = {"NEBIUS_API_KEY": "test-key"}
                client, _ = scripted_client([
                    tool_message(name, raw),
                    SimpleNamespace(content="Recovered from tool error.", tool_calls=[]),
                ])
                with patch.object(kimi, "get_client", return_value=nullcontext(client)):
                    app.run()
                    app.button[0].click().run()
                    self.assertEqual(len(app.exception), 0)
                    self.assertEqual(app.session_state["chat"][-1]["content"], "Recovered from tool error.")
                    self.assertIn("error", app.session_state["chat"][-1]["steps"][0].result)
                    self.assertEqual(len(app.expander), 1)
                    app.run()
                    self.assertEqual(len(app.exception), 0)

    def test_legacy_non_object_steps_do_not_break_existing_sessions(self):
        app = AppTest.from_file(str(RECIPE / "app.py"), default_timeout=20).run()
        app.session_state["chat"] = [{
            "role": "assistant", "content": "Earlier answer",
            "steps": [agent.Step("unknown_tool", [], {"error": "Unknown tool"})],
        }]
        app.run()
        self.assertEqual(len(app.exception), 0)
        self.assertEqual(len(app.expander), 1)


if __name__ == "__main__":
    unittest.main()
