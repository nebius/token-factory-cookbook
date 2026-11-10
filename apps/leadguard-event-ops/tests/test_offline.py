"""Credential-free checks: no Token Factory calls, no network.

Run from the recipe directory: uv run python -m unittest discover -s tests
"""

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import agent  # noqa: E402
import event  # noqa: E402
import tools  # noqa: E402


def kinds(ev):
    return sorted({a["kind"] for a in event.anomalies(ev)})


class IntegrityTest(unittest.TestCase):
    def test_calm_morning_has_no_anomalies(self):
        self.assertEqual(kinds(event.synthetic()), [])

    def test_wifi_drop_is_late_not_lost(self):
        ev = event.synthetic()
        before = len(ev.scans)
        event.wifi_drop(ev, "radar", scans=6)
        self.assertEqual(len(ev.scans), before + 6)
        self.assertEqual(kinds(ev), [])  # a late sync is not an anomaly
        tl = tools.get_booth_timeline(ev, "radar")
        self.assertEqual(tl["synced_late"], 6)
        self.assertEqual(tl["scans_waiting_on_devices"], 0)

    def test_each_scenario_raises_its_anomaly(self):
        for scenario, expected in [(event.ghost_badge, "never_checked_in"), (event.teleport, "impossible_travel"),
                                   (event.scanner_stuck, "scans_not_syncing")]:
            with self.subTest(expected=expected):
                ev = event.synthetic()
                scenario(ev)
                self.assertIn(expected, kinds(ev))

    def test_stuck_scanner_also_makes_the_booth_silent(self):
        ev = event.synthetic()
        event.scanner_stuck(ev, "dash0")
        booths = {a["booth_id"] for a in event.anomalies(ev) if a["kind"] == "silent_booth"}
        self.assertEqual(booths, {"dash0"})

    def test_clock_tolerance(self):
        ev = event.synthetic()
        badge = sorted(ev.checkins)[0]
        first = ev.checkins[badge]
        ev.scans.append(event.Scan("x1", badge, "radar", "scanner-radar", first - event.timedelta(minutes=1), first))
        self.assertNotIn("scanned_before_checkin", kinds(ev))
        ev.scans.append(event.Scan("x2", badge, "radar", "scanner-radar", first - event.timedelta(minutes=5), first))
        self.assertIn("scanned_before_checkin", kinds(ev))

    def test_deterministic(self):
        a, b = event.synthetic(), event.synthetic()
        self.assertEqual([(s.badge_id, s.booth_id, s.scanned_at) for s in a.scans], [(s.badge_id, s.booth_id, s.scanned_at) for s in b.scans])


class ToolTest(unittest.TestCase):
    def setUp(self):
        self.ev = event.synthetic()
        event.wifi_drop(self.ev)
        event.ghost_badge(self.ev)

    def test_tools_never_expose_names_or_emails(self):
        out = "".join(tools.call(self.ev, s["function"]["name"], {"booth_id": "radar"} if "booth_id" in s["function"]["parameters"].get("required", []) else {})
                      for s in tools.SCHEMAS if s["function"]["name"] != "draft_sponsor_message")
        for person in self.ev.attendees.values():
            self.assertNotIn(person["email"], out)
            self.assertNotIn(person["name"], out)

    def test_bad_arguments_come_back_as_data(self):
        self.assertIn("error", json.loads(tools.call(self.ev, "get_booth_timeline", '{"booth_id": "nope"}')))
        self.assertIn("error", json.loads(tools.call(self.ev, "get_booth_timeline", "{not json")))
        self.assertIn("error", json.loads(tools.call(self.ev, "rm_rf", "{}")))
        # unknown argument names are dropped, not passed through
        self.assertNotIn("error", json.loads(tools.call(self.ev, "get_booth_health", '{"evil": 1}')))

    def test_draft_is_only_a_draft(self):
        r = json.loads(tools.call(self.ev, "draft_sponsor_message", {"booth_id": "radar", "subject": "Hi", "body": "Your leads are safe."}))
        self.assertEqual(r["status"], "awaiting_approval")
        self.assertEqual(self.ev.drafts[0]["status"], "awaiting_approval")

    def test_schemas_match_functions(self):
        self.assertEqual({s["function"]["name"] for s in tools.SCHEMAS}, set(tools.FUNCS))


def fake_client(script):
    """A stand-in for the OpenAI client that replays a list of assistant messages."""
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=script.pop(0))])

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))), calls


def tool_msg(*pairs):
    return SimpleNamespace(content="", tool_calls=[SimpleNamespace(id=f"c{i}", function=SimpleNamespace(name=n, arguments=json.dumps(a)))
                                                    for i, (n, a) in enumerate(pairs)])


class AgentLoopTest(unittest.TestCase):
    def test_tool_loop_then_answer(self):
        ev = event.synthetic()
        event.wifi_drop(ev)
        client, calls = fake_client([
            tool_msg(("get_booth_timeline", {"booth_id": "radar", "minutes": 60})),
            SimpleNamespace(content="No leads lost: 6 scans synced late.", tool_calls=None),
        ])
        ans = agent.ask(client, "moonshotai/Kimi-K3.1-Pro", ev, "Were leads lost at Radar?")
        self.assertEqual(ans.text, "No leads lost: 6 scans synced late.")
        self.assertEqual([s.tool for s in ans.steps], ["get_booth_timeline"])
        self.assertEqual(ans.steps[0].result["synced_late"], 6)
        tool_reply = calls[1]["messages"][-1]
        self.assertEqual(tool_reply["role"], "tool")
        self.assertEqual(tool_reply["tool_call_id"], "c0")
        self.assertEqual(calls[0]["model"], "moonshotai/Kimi-K3.1-Pro")

    def test_stops_after_max_steps(self):
        ev = event.synthetic()
        client, _ = fake_client([tool_msg(("get_booth_health", {})) for _ in range(agent.MAX_STEPS)])
        ans = agent.ask(client, "m", ev, "loop forever")
        self.assertTrue(ans.stopped_early)
        self.assertEqual(len(ans.steps), agent.MAX_STEPS)


if __name__ == "__main__":
    unittest.main()
