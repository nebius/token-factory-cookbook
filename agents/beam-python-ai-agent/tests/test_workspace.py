"""Offline tests: no network, no API key, no model."""

import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent import play  # noqa: E402
from workspace import REGIONS, SalesWorkspace, call_tool  # noqa: E402


def test_same_seed_builds_the_same_data():
    assert SalesWorkspace(11).csv_text == SalesWorkspace(11).csv_text
    assert SalesWorkspace(11).csv_text != SalesWorkspace(12).csv_text


def test_answers_match_an_independent_pandas_calculation():
    for seed in range(10):
        workspace = SalesWorkspace(seed)
        df = pd.read_csv(io.StringIO(workspace.csv_text))
        df["net"] = df.quantity * df.unit_price * (1 - df.discount)
        q2 = df[df.order_date.between("2026-04-01", "2026-06-30")]
        top = q2[q2.status == "completed"].groupby("region").net.sum().idxmax()
        online = df[(df.channel == "online") & (df.status == "completed")]
        may = online[online.order_date.str.startswith("2026-05")].net.sum()
        june = online[online.order_date.str.startswith("2026-06")].net.sum()
        refund_rate = (q2[q2.region == top].status == "refunded").mean() * 100

        region, growth, rate = workspace.expected
        assert region == top
        assert abs(growth - (june - may) / may * 100) < 1e-9
        assert abs(rate - refund_rate) < 1e-9


def test_the_top_region_is_never_a_tie():
    for seed in range(20):
        workspace = SalesWorkspace(seed)
        q2 = [o for o in workspace.orders if o["order_date"] >= "2026-04-01" and o["status"] == "completed"]
        totals = sorted(
            (sum(o["quantity"] * o["unit_price"] * (1 - o["discount"]) for o in q2 if o["region"] == r) for r in REGIONS),
            reverse=True,
        )
        assert totals[0] > totals[1]


def test_grading_accepts_formatting_and_rejects_wrong_answers():
    workspace = SalesWorkspace(3)
    region, growth, rate = workspace.expected
    workspace.submit(1, f"{region} had the highest net revenue")
    workspace.submit(2, f"{growth:.1f}%")
    workspace.submit(3, f"{rate:.1f} percent")
    assert workspace.grade() == [True, True, True]

    other = next(r for r in REGIONS if r != region)
    workspace.submit(1, f"{region} or {other}")
    workspace.submit(2, f"{growth + 1:.1f}")
    assert workspace.grade() == [False, False, True]


def test_sandbox_reads_the_data_without_the_api_key(monkeypatch):
    monkeypatch.setenv("NEBIUS_API_KEY", "do-not-leak")
    code = "import os, pandas as pd\nprint(len(pd.read_csv('orders.csv')), os.environ.get('NEBIUS_API_KEY'))"
    result = SalesWorkspace(1).run_python(code)
    assert result["exit_code"] == 0 and result["stdout"] == "3000 None\n"


def test_sandbox_times_out():
    assert "Timed out" in SalesWorkspace(1).run_python("while True: pass", timeout=0.5)["stderr"]


def test_bad_calls_are_reported_not_raised():
    workspace = SalesWorkspace(1)
    assert "no tool named 'bash'" in json.loads(call_tool(workspace, "bash", '{"command": "ls"}'))["error"]
    assert "question must be" in json.loads(call_tool(workspace, "submit_answer", '{"question": 4, "answer": "x"}'))["error"]


class FakeClient:
    """Describes the data, submits the three right answers, then summarizes."""

    def __init__(self, seed):
        region, growth, rate = SalesWorkspace(seed).expected
        answers = [region, f"{growth:.1f}", f"{rate:.1f}"]
        self.script = [("describe_data", {})] + [
            ("submit_answer", {"question": n, "answer": a}) for n, a in enumerate(answers, 1)
        ] + [None]
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append(json.loads(json.dumps(kwargs["messages"])))
        step = self.script[len(self.requests) - 1]
        tool_calls = None
        if step:
            name, args = step
            call_id = f"call_{len(self.requests)}"
            tool_calls = [SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=json.dumps(args)))]
        message = SimpleNamespace(
            content=None if step else "All three answers are recorded.",
            tool_calls=tool_calls,
            reasoning_content=f"thinking {len(self.requests)}",
        )
        usage = SimpleNamespace(
            prompt_tokens=100,
            completion_tokens=20,
            completion_tokens_details=SimpleNamespace(reasoning_tokens=15),
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="stop")], usage=usage)


def test_loop_sends_reasoning_and_tool_ids_back_and_grades_the_run():
    client = FakeClient(seed=5)
    run = play(client, seed=5, prices=(0.25e-6, 1e-6), log=lambda line: None)

    assert run["correct"] == 3 and run["tool_calls"] == 4 and run["final"] == "All three answers are recorded."
    assert run["prompt_tokens"] == 500 and run["reasoning_tokens"] == 75
    assert run["cost_usd"] == round(500 * 0.25e-6 + 100 * 1e-6, 5)

    second = client.requests[1]
    assistant, tool = second[-2], second[-1]
    assert assistant["reasoning_content"] == "thinking 1"
    assert tool["role"] == "tool" and tool["tool_call_id"] == assistant["tool_calls"][0]["id"]
