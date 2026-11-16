"""Credential-free checks: no Token Factory calls, no network.

Covers the fetch_url address guard, tier routing and escalation, the cost
ledger, and a full LangGraph run (plan, parallel workers, review, revision,
synthesis) with stubs in place of the models.

Run from the recipe directory: uv run python -m unittest discover -s tests
"""

from __future__ import annotations

import os
import unittest
from unittest import mock

os.environ.pop("NEBIUS_API_KEY", None)  # make sure nothing here can reach the API

from langchain_core.messages import AIMessage, AIMessageChunk  # noqa: E402

import models  # noqa: E402
import orchestrator  # noqa: E402
import tools  # noqa: E402

KIMI = "moonshotai/Kimi-K3.1-Pro"
INKLING = "thinkingmachines/Inkling-2-Small"
NEMOTRON = "nvidia/Nemotron-3_5-Lightning"


def setUpModule():
    # Even with a key in .env, price lookups use the bundled table, not the live catalog.
    patcher = mock.patch.object(models, "catalog", return_value={})
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)


def settings(**overrides) -> dict:
    return orchestrator.make_settings(orchestrator=KIMI, worker=INKLING, fast_worker=NEMOTRON, **overrides)


class FetchUrlGuardTests(unittest.TestCase):
    def test_refuses_non_public_and_malformed_urls(self):
        for url in (
            "http://127.0.0.1/admin",
            "http://localhost:8501/",
            "http://10.0.0.5/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "file:///etc/passwd",
            "ftp://8.8.8.8/",
            "https://user:pass@8.8.8.8/",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                tools._pinned_request(url)

    def test_pins_the_checked_address_and_keeps_the_hostname_for_tls(self):
        fake = [(None, None, None, None, ("93.184.215.14", 443))]
        with mock.patch.object(tools.socket, "getaddrinfo", return_value=fake):
            target, headers, extensions = tools._pinned_request("https://example.com/docs?q=1")
        self.assertEqual(target, "https://93.184.215.14:443/docs?q=1")
        self.assertEqual(headers, {"Host": "example.com"})
        self.assertEqual(extensions, {"sni_hostname": "example.com"})

    def test_refuses_a_host_that_resolves_to_any_private_address(self):
        fake = [
            (None, None, None, None, ("93.184.215.14", 80)),
            (None, None, None, None, ("10.1.2.3", 80)),
        ]
        with mock.patch.object(tools.socket, "getaddrinfo", return_value=fake):
            with self.assertRaises(ValueError):
                tools._pinned_request("http://rebind.example/")

    def test_fetch_url_reports_refusals_as_text(self):
        out = tools.fetch_url.invoke({"url": "http://127.0.0.1:22/"})
        self.assertTrue(out.startswith("Could not fetch"), out)

    def test_html_to_text_drops_scripts_and_markup(self):
        text = tools._html_to_text("<head><title>x</title></head><script>alert(1)</script><p>Hello &amp; bye</p>")
        self.assertEqual(text, "Hello & bye")


class RoutingTests(unittest.TestCase):
    def test_clean_tasks_slugs_dedupes_and_limits(self):
        tasks = [
            orchestrator.Subtask(id="Pricing Compare", title="a", brief="b", tier="fast"),
            orchestrator.Subtask(id="pricing-compare", title="a", brief="b", tier="standard"),
            orchestrator.Subtask(id="extra", title="a", brief="b", tier="standard"),
        ]
        cleaned = orchestrator._clean_tasks(tasks, limit=2)
        self.assertEqual([t["id"] for t in cleaned], ["pricing-compare", "pricing-compare-2"])

    def test_fast_tasks_start_cheap_and_escalate_on_revision(self):
        state = {"goal": "g", "settings": settings()}
        fast = {"id": "f", "title": "t", "brief": "b", "tier": "fast"}
        standard = {"id": "s", "title": "t", "brief": "b", "tier": "standard"}
        self.assertEqual(orchestrator._worker_input(state, fast)["model"], NEMOTRON)
        self.assertEqual(orchestrator._worker_input(state, standard)["model"], INKLING)
        retry = orchestrator._worker_input(state, fast, feedback="fix it", previous="old", attempt=2)
        self.assertEqual(retry["model"], INKLING)
        self.assertTrue(retry["escalated"])

    def test_make_settings_clamps_limits(self):
        s = settings(max_tasks=50, max_revisions=-3)
        self.assertEqual(s["max_tasks"], 8)
        self.assertEqual(s["max_revisions"], 0)

    def test_text_strips_inline_reasoning(self):
        self.assertEqual(orchestrator._text(AIMessage("<think>hmm</think>\nAnswer")), "Answer")


class CostTests(unittest.TestCase):
    def test_fallback_prices_when_catalog_is_unreachable(self):
        self.assertAlmostEqual(models.cost_usd(KIMI, 1_000_000, 1_000_000), 12.0)
        self.assertEqual(models.price("unknown/model"), (0.0, 0.0))
        self.assertEqual(models.resolve_orchestrator(KIMI), KIMI)

    def test_orchestrator_falls_back_when_the_key_cannot_see_it(self):
        with mock.patch.object(models, "catalog", return_value={"moonshotai/Kimi-K3": (3.0, 15.0)}):
            self.assertEqual(models.resolve_orchestrator(KIMI), "moonshotai/Kimi-K3")

    def test_cost_summary_compares_against_an_all_orchestrator_run(self):
        ledger = [
            {"role": "plan", "model": KIMI, "input_tokens": 1000, "output_tokens": 500,
             "cost": models.cost_usd(KIMI, 1000, 500)},
            {"role": "worker", "model": INKLING, "input_tokens": 10_000, "output_tokens": 2000,
             "cost": models.cost_usd(INKLING, 10_000, 2000)},
        ]
        summary = orchestrator.cost_summary(ledger, KIMI)
        self.assertAlmostEqual(summary["total"], 0.007 + 0.005)
        self.assertAlmostEqual(summary["all_orchestrator_total"], 0.007 + 0.04)
        self.assertGreater(summary["savings_pct"], 70)
        self.assertEqual(summary["tokens"], 13_500)


class FakeStreamingChat:
    def stream(self, messages):
        yield AIMessageChunk(content="Final ")
        yield AIMessageChunk(content="report")


class GraphRunTests(unittest.TestCase):
    """Runs the real LangGraph graph with the model calls stubbed out."""

    def test_plan_fan_out_review_escalation_and_synthesis(self):
        plan = orchestrator.TaskPlan(
            approach="split by database",
            final_format="short report",
            tasks=[
                orchestrator.Subtask(id="lookup", title="Lookup", brief="find limits", tier="fast"),
                orchestrator.Subtask(id="analysis", title="Analysis", brief="compare", tier="standard"),
            ],
        )
        review = orchestrator.Review(
            summary="one claim is wrong",
            verdicts=[
                orchestrator.Verdict(task_id="lookup", decision="revise", feedback="max document size is 16MB"),
                orchestrator.Verdict(task_id="analysis", decision="accept"),
            ],
        )
        calls = []

        def fake_structured(model, schema, system, user, role):
            record = {"role": role, "model": model, "input_tokens": 100, "output_tokens": 50, "cost": 0.001}
            return (plan if schema is orchestrator.TaskPlan else review), [record]

        def fake_worker(inp, ledger, write):
            calls.append((inp["task"]["id"], inp["model"], inp["attempt"], inp["feedback"]))
            ledger.append({"role": "worker", "model": inp["model"], "input_tokens": 200,
                           "output_tokens": 100, "cost": 0.0001})
            return f"{inp['task']['id']} attempt {inp['attempt']}", 0

        with (
            mock.patch.object(orchestrator, "_structured", side_effect=fake_structured),
            mock.patch.object(orchestrator, "_run_worker", side_effect=fake_worker),
            mock.patch.object(orchestrator, "chat", return_value=FakeStreamingChat()),
        ):
            events = list(orchestrator.run("compare databases", settings(max_revisions=1)))

        kinds = [e["event"] for e in events]
        self.assertEqual(kinds[-1], "done")
        self.assertEqual(sum(k == "worker_done" for k in kinds), 3)
        self.assertIn(("lookup", NEMOTRON, 1, ""), calls)
        self.assertIn(("analysis", INKLING, 1, ""), calls)
        self.assertIn(("lookup", INKLING, 2, "max document size is 16MB"), calls)

        state = events[-1]["state"]
        self.assertEqual(state["results"]["lookup"]["output"], "lookup attempt 2")
        self.assertTrue(state["results"]["lookup"]["escalated"])
        self.assertEqual(state["results"]["analysis"]["attempt"], 1)
        self.assertEqual(state["final"], "Final report")
        self.assertEqual(len(state["reviews"]), 1)  # the revision budget allows one review round


if __name__ == "__main__":
    unittest.main()
