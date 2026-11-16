"""Credential-free checks: no Token Factory calls, no network.

Covers the cron server, schedule validation, the simulated world and the
runtime's skip-when-quiet rule. A stub stands in for the LangChain agent.

Run from the recipe directory: uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from cron import CronServer, define_schedule
from desk import Desk
from runtime import SCHEDULES_DIR, OnCallRuntime
from world import World

START = datetime(2026, 11, 16, 9, 0)


class StubAgent:
    """Stands in for the LangChain agent: records each wake-up, calls no tools."""

    def __init__(self):
        self.messages: list[str] = []

    def stream(self, inputs, config=None, context=None, stream_mode=None):
        self.messages.append(inputs["messages"][0].content)
        return iter(())


def run_until(world: World, hhmm: str) -> None:
    hh, mm = map(int, hhmm.split(":"))
    while world.now < START.replace(hour=hh, minute=mm):
        world.advance()


class CronServerTests(unittest.TestCase):
    def test_static_schedules_load_and_fire_on_time(self):
        cron = CronServer(START)
        cron.load_static(SCHEDULES_DIR)
        self.assertEqual(set(cron.schedules), {"triage", "shift_handoff"})
        fired = {}
        now = START
        while now <= START.replace(minute=50):
            for s in cron.due(now):
                fired.setdefault(s.id, []).append(f"{now:%H:%M}")
                cron.mark_fired(s, now)
            now += timedelta(minutes=1)
        self.assertEqual(fired["triage"][:3], ["09:00", "09:05", "09:10"])
        self.assertEqual(fired["shift_handoff"], ["09:47"])

    def test_agent_follow_ups_fire_once_and_keep_their_thread(self):
        cron = CronServer(START)
        s = cron.create(now=START, at=START + timedelta(minutes=3), prompt="check", thread_id="t-1")
        self.assertEqual(cron.due(START + timedelta(minutes=2)), [])
        self.assertEqual(cron.due(START + timedelta(minutes=3)), [s])
        cron.mark_fired(s, START + timedelta(minutes=3))
        self.assertFalse(s.active)
        self.assertEqual(s.thread_id, "t-1")
        r = cron.create(now=START, cron="*/10 * * * *", prompt="watch disk")
        self.assertEqual(r.next_run, START + timedelta(minutes=10))
        cron.cancel(r.id, by="run-9")
        self.assertEqual(cron.active(owner="agent"), [])

    def test_schedule_validation(self):
        cron = CronServer(START)
        cron.load_static(SCHEDULES_DIR)
        with self.assertRaises(ValueError):
            cron.create(now=START, prompt="x", cron="* * * *")  # 4 fields
        with self.assertRaises(ValueError):
            cron.create(now=START, prompt="x", at=START)  # not in the future
        with self.assertRaises(ValueError):
            cron.create(now=START, prompt="x")  # neither cron nor at
        with self.assertRaises(ValueError):
            cron.cancel("triage", by="run-1")  # static schedules live in code
        with self.assertRaises(ValueError):
            define_schedule(cron="every 5 minutes", prompt="x")


class WorldTests(unittest.TestCase):
    def test_bad_deploy_breaks_checkout_and_rollback_fixes_it(self):
        w = World(START)
        run_until(w, "09:15")
        self.assertEqual(w.current("checkout-api").version, "v2.14.0")
        self.assertGreater(w.metrics[-1]["error_rate"], 3.5)
        crit = [e for e in w.events if e.kind == "alert" and e.severity == "critical"]
        self.assertTrue(crit)
        self.assertLessEqual(crit[0].at, START.replace(minute=14))

        with self.assertRaises(ValueError):
            w.request_rollback("checkout-api", "v9.9.9", "typo", "run-4")
        a = w.request_rollback("checkout-api", "v2.13.2", "errors after deploy", "run-4")
        with self.assertRaises(ValueError):  # already pending
            w.request_rollback("checkout-api", "v2.13.2", "again", "run-5")
        w.decide(a.id, True, by="you")
        run_until(w, "09:22")
        self.assertEqual(w.current("checkout-api").version, "v2.13.2")
        self.assertLess(w.metrics[-1]["error_rate"], 1.0)
        self.assertTrue(any(e.kind == "alert" and e.text.startswith("Recovered") for e in w.events))

    def test_disk_story_and_provider_outage(self):
        w = World(START)
        run_until(w, "09:26")
        disk_alerts = [e for e in w.events if e.service == "orders-db" and e.kind == "alert"]
        minutes = [e.at.minute for e in disk_alerts]  # crosses 70%, then 80%
        self.assertEqual(len(minutes), 2, minutes)
        self.assertLessEqual(minutes[0], 5)
        self.assertTrue(20 <= minutes[1] <= 25, minutes)
        run_until(w, "09:32")
        self.assertLess(w.metrics[-1]["disk_pct"], 60)

        w2 = World(START)
        w2.inject("provider_outage")
        run_until(w2, "09:06")
        self.assertGreater(w2.metrics[-1]["error_rate"], 2.5)  # hurts checkout whatever version runs


class DeskTests(unittest.TestCase):
    def test_one_open_incident_per_service(self):
        desk = Desk()
        inc = desk.open_incident(START, "orders-db", "disk filling", "sev3", "71%", "run-2")
        with self.assertRaises(ValueError):
            desk.open_incident(START, "orders-db", "disk filling again", "sev3", "77%", "run-5")
        desk.open_incident(START, "checkout-api", "5xx spike", "sev1", "5%", "run-4")  # other services are fine
        desk.resolve_incident(START, inc.id, "logs rotated")
        desk.open_incident(START, "orders-db", "disk again", "sev3", "85%", "run-9")  # allowed once resolved


class RuntimeTests(unittest.TestCase):
    def test_runtime_skips_quiet_triage_and_marks_events_read(self):
        stub = StubAgent()
        with tempfile.TemporaryDirectory() as tmp:
            rt = OnCallRuntime(start=START, agent=stub, memory_path=Path(tmp) / "memory.md")
            rt.fire(rt.cron.schedules["triage"])  # 09:00, nothing has happened yet
            self.assertEqual(rt.runs[-1].status, "skipped")
            self.assertEqual(stub.messages, [])
            while rt.world.now < START.replace(minute=5):
                rt.step()
            self.assertEqual(rt.runs[-1].status, "done")
            self.assertEqual(rt.world.unread(), [])
            self.assertIn("Schedule `triage`", stub.messages[-1])


if __name__ == "__main__":
    unittest.main()
