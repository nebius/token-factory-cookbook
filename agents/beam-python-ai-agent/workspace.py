"""A seeded sales dataset, three business questions, and the tools an agent uses to answer them.

The workspace builds the same orders for the same seed and computes every answer
itself, so each run can be graded without a human or a judge model.
"""

from __future__ import annotations

import csv
import io
import json
import random
import re
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

REGIONS = ["North America", "Europe", "Asia Pacific", "Latin America"]
PRODUCTS = {
    "Starter plan": 29.0,
    "Team plan": 99.0,
    "Business plan": 249.0,
    "Analytics add-on": 49.0,
    "Support package": 149.0,
    "Onboarding service": 399.0,
}
CHANNELS = ["online", "partner", "retail"]
DISCOUNTS = [0.0, 0.0, 0.05, 0.1, 0.15]
DATA_FILE = "orders.csv"
OUTPUT_LIMIT = 4000

DEFINITIONS = (
    "Net revenue is quantity x unit_price x (1 - discount), counting completed orders only. "
    "Refund rate is refunded orders divided by all orders."
)
QUESTIONS = [
    "Which region had the highest net revenue in Q2 2026 (April to June)?",
    "By what percentage did net revenue from the online channel change from May to June 2026? Round to one decimal place.",
    "What was the refund rate in Q2 2026 for the region from question 1, as a percentage of that region's Q2 orders? "
    "Round to one decimal place.",
]


def build_orders(seed: int, count: int = 3000) -> list[dict]:
    """Six months of orders whose regional mix, online trend, and refund rates depend on the seed."""
    rng = random.Random(seed)
    region_weights = [rng.uniform(0.6, 1.4) for _ in REGIONS]
    refund_rates = {region: rng.uniform(0.03, 0.12) for region in REGIONS}
    online_trend = rng.uniform(-0.2, 0.3)
    orders = []
    for _ in range(count):
        day = date(2026, 1, 1) + timedelta(days=rng.randrange(181))
        online_weight = 1.2 * (1 + online_trend) ** (day.month - 1)
        region = rng.choices(REGIONS, weights=region_weights)[0]
        product = rng.choice(list(PRODUCTS))
        orders.append(
            {
                "order_date": day.isoformat(),
                "region": region,
                "product": product,
                "channel": rng.choices(CHANNELS, weights=[online_weight, 1.0, 0.8])[0],
                "quantity": rng.randint(1, 5),
                "unit_price": PRODUCTS[product],
                "discount": rng.choice(DISCOUNTS),
                "status": "refunded" if rng.random() < refund_rates[region] else "completed",
            }
        )
    orders.sort(key=lambda order: order["order_date"])
    return [{"order_id": f"SO-{10000 + i}", **order} for i, order in enumerate(orders)]


def net_revenue(order: dict) -> float:
    return order["quantity"] * order["unit_price"] * (1 - order["discount"])


def expected_answers(orders: list[dict]) -> list:
    q2 = [o for o in orders if "2026-04-01" <= o["order_date"] <= "2026-06-30"]
    by_region = {r: sum(net_revenue(o) for o in q2 if o["region"] == r and o["status"] == "completed") for r in REGIONS}
    top_region = max(by_region, key=by_region.get)

    def online(month: str) -> float:
        return sum(
            net_revenue(o)
            for o in orders
            if o["order_date"].startswith(month) and o["channel"] == "online" and o["status"] == "completed"
        )

    growth = (online("2026-06") - online("2026-05")) / online("2026-05") * 100
    in_region = [o for o in q2 if o["region"] == top_region]
    refund_rate = sum(o["status"] == "refunded" for o in in_region) / len(in_region) * 100
    return [top_region, growth, refund_rate]


def to_csv(orders: list[dict]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(orders[0]))
    writer.writeheader()
    writer.writerows(orders)
    return out.getvalue()


def parse_number(answer: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", answer.replace(",", "").replace("−", "-"))
    return float(match.group()) if match else None


class SalesWorkspace:
    def __init__(self, seed: int):
        self.orders = build_orders(seed)
        self.csv_text = to_csv(self.orders)
        self.expected = expected_answers(self.orders)
        self.answers: dict[int, str] = {}

    def describe(self) -> dict:
        return {
            "file": DATA_FILE,
            "rows": len(self.orders),
            "columns": {
                "order_id": "text, for example SO-10000",
                "order_date": "YYYY-MM-DD, from 2026-01-01 to 2026-06-30",
                "region": ", ".join(REGIONS),
                "product": ", ".join(PRODUCTS),
                "channel": ", ".join(CHANNELS),
                "quantity": "integer",
                "unit_price": "USD per unit",
                "discount": "fraction, for example 0.1",
                "status": "completed or refunded",
            },
            "note": f"run_python starts in a folder that contains {DATA_FILE}. pandas is installed.",
        }

    def submit(self, question: int, answer: str) -> dict:
        if question not in (1, 2, 3):
            return {"error": "question must be 1, 2, or 3"}
        self.answers[question] = answer
        return {"recorded": True, "question": question, "answers_recorded": sorted(self.answers)}

    def grade(self) -> list[bool]:
        region, growth, refund_rate = self.expected
        first = self.answers.get(1, "").lower()
        named = [r for r in REGIONS if r.lower() in first]
        results = [named == [region]]
        for number, truth in ((2, growth), (3, refund_rate)):
            value = parse_number(self.answers.get(number, ""))
            results.append(value is not None and abs(value - truth) <= 0.051)
        return results

    def run_python(self, code: str, timeout: float = 20.0) -> dict:
        """Run code in a child interpreter with an empty environment and a time limit.

        The child cannot read your API key and cannot run forever. It is not a
        security boundary: it can still reach the network and your files, so run
        model-written code in a container or VM before pointing this at anything
        you care about.
        """
        with tempfile.TemporaryDirectory() as workdir:
            Path(workdir, DATA_FILE).write_text(self.csv_text)
            try:
                done = subprocess.run(
                    [sys.executable, "-I", "-"],
                    input=code,
                    cwd=workdir,
                    env={},
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired:
                return {"exit_code": None, "stdout": "", "stderr": f"Timed out after {timeout:g} seconds."}
        return {"exit_code": done.returncode, "stdout": done.stdout[-OUTPUT_LIMIT:], "stderr": done.stderr[-OUTPUT_LIMIT:]}


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "describe_data",
            "description": "Describe orders.csv: its row count, columns, and allowed values.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": "Run a self-contained Python 3 script next to orders.csv and return its exit code, stdout, and stderr. pandas is installed. Print what you need to see.",
            "parameters": {
                "type": "object",
                "properties": {"code": {"type": "string", "description": "The Python source to run."}},
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_answer",
            "description": "Record your final answer to one question. Submitting again replaces the earlier answer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "integer", "description": "The question number: 1, 2, or 3."},
                    "answer": {"type": "string", "description": "The answer, for example a region name or a number."},
                },
                "required": ["question", "answer"],
            },
        },
    },
]


def call_tool(workspace: SalesWorkspace, name: str, arguments: str | None) -> str:
    try:
        args = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        return json.dumps({"error": "Arguments were not valid JSON."})
    if name == "describe_data":
        result = workspace.describe()
    elif name == "run_python":
        result = workspace.run_python(str(args.get("code", "")))
    elif name == "submit_answer":
        try:
            question = int(args.get("question"))
        except (TypeError, ValueError):
            return json.dumps({"error": "question must be 1, 2, or 3"})
        result = workspace.submit(question, str(args.get("answer", "")))
    else:
        result = {"error": f"There is no tool named {name!r}. Use describe_data, run_python, or submit_answer."}
    return json.dumps(result)
