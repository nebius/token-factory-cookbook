"""Measure accuracy and calibration of the decision model on labeled tickets.

Compares four ways of getting a confidence score for the same routing
question: the model's self-reported confidence, one logprob read, four
rotated logprob reads, and four rotated reads with a fitted temperature.
"""

from __future__ import annotations

import json
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

from decider import Decider, Question

INPUT_PRICE, OUTPUT_PRICE = 0.15, 0.50  # USD per 1M tokens, GLM-5.3-Flash list price
THRESHOLD = 0.9
BASELINE_USAGE = {"requests": 0, "prompt_tokens": 0, "completion_tokens": 0, "unparsed": 0}

TEAMS = (
    "Teams:\n"
    "- billing: charges, refunds, invoices, payment methods, tax, renewals of an existing plan\n"
    "- technical: bugs, errors, outages, API, SDK and integration problems\n"
    "- account: login, access, users, roles, workspace settings, personal data\n"
    "- sales: new purchases, upgrades, quotes, demos, trials, contracts, procurement and security reviews"
)
ROUTE = Question.choice("team", f"{TEAMS}\n\nWhich team should handle this ticket?",
                        ["billing", "technical", "account", "sales"])


def ece(confidences: list[float], correct: list[bool], bins: int = 10) -> float:
    total, n = 0.0, len(confidences)
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        idx = [i for i, c in enumerate(confidences) if lo < c <= hi or (b == 0 and c == 0)]
        if idx:
            acc = sum(correct[i] for i in idx) / len(idx)
            conf = sum(confidences[i] for i in idx) / len(idx)
            total += len(idx) / n * abs(acc - conf)
    return total


def auroc(confidences: list[float], correct: list[bool]) -> float:
    """Probability that a right answer gets a higher confidence than a wrong one."""
    right = [c for c, ok in zip(confidences, correct) if ok]
    wrong = [c for c, ok in zip(confidences, correct) if not ok]
    if not right or not wrong:
        return float("nan")
    wins = sum((r > w) + 0.5 * (r == w) for r in right for w in wrong)
    return wins / (len(right) * len(wrong))


def summarize(name: str, dists: list[dict[str, float]], labels: list[str]) -> dict:
    answers = [max(d, key=d.get) for d in dists]
    conf = [d[a] for d, a in zip(dists, answers)]
    correct = [a == y for a, y in zip(answers, labels)]
    auto = [i for i, c in enumerate(conf) if c >= THRESHOLD]
    return {
        "method": name,
        "accuracy": sum(correct) / len(correct),
        "auroc": auroc(conf, correct),
        "ece": ece(conf, correct),
        "distinct_confidences": len({round(c, 3) for c in conf}),
        "log_loss": -sum(math.log(max(d[y], 1e-6)) for d, y in zip(dists, labels)) / len(labels),
        "auto_decided": len(auto) / len(conf),
        "auto_accuracy": sum(correct[i] for i in auto) / len(auto) if auto else None,
    }


def verbalized(decider: Decider, text: str) -> dict[str, float]:
    """Baseline: generate a JSON answer with a self-reported confidence."""
    prompt = (f"[gMASK]<sop><|user|>\nTicket: {text}\n\n{TEAMS}\n\nWhich team should handle this ticket? "
              'Reply with JSON only: {"team": "...", "confidence": <number from 0 to 1>}<|assistant|>\n</think>')
    response = decider.client.completions.create(
        model=decider.model, prompt=prompt, temperature=0, max_tokens=40)
    BASELINE_USAGE["requests"] += 1
    BASELINE_USAGE["prompt_tokens"] += response.usage.prompt_tokens
    BASELINE_USAGE["completion_tokens"] += response.usage.completion_tokens
    match = re.search(r"\{.*?\}", response.choices[0].text, re.S)
    try:
        parsed = json.loads(match.group(0))
        team, c = parsed["team"].lower(), float(parsed["confidence"])
    except (AttributeError, ValueError, KeyError, TypeError):
        team, c = "", 0.0
    if team not in ROUTE.options:
        BASELINE_USAGE["unparsed"] += 1
        return {o: 0.25 for o in ROUTE.options}
    others = [o for o in ROUTE.options if o != team]
    return {team: c, **{o: (1 - c) / len(others) for o in others}}


def main() -> None:
    tickets = [json.loads(line) for line in open("data/tickets.jsonl")]
    decider = Decider(rotations=4)

    def run(ticket: dict) -> tuple[list[dict], dict, float]:
        start = time.perf_counter()
        masses = decider.label_masses(f"Ticket: {ticket['text']}", ROUTE)
        latency = time.perf_counter() - start
        return masses, verbalized(decider, ticket["text"]), latency

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(run, tickets))
    wall = time.perf_counter() - started

    labels = [t["team"] for t in tickets]
    one = [decider.combine(ROUTE, m[:1]) for m, _, _ in results]
    four = [decider.combine(ROUTE, m) for m, _, _ in results]

    # Two-fold cross-fit: each half's temperature is fitted on the other half,
    # so no ticket is scored with a temperature that saw its own label.
    halves = [list(range(0, len(tickets), 2)), list(range(1, len(tickets), 2))]
    scaled: dict[int, dict[str, float]] = {}
    temps = []
    for fit, score in (halves, halves[::-1]):
        decider.temperatures.clear()
        temps.append(decider.calibrate(ROUTE, [four[i].distribution for i in fit], [labels[i] for i in fit]))
        for i in score:
            scaled[i] = decider.combine(ROUTE, results[i][0]).distribution

    report = [
        summarize("self-reported confidence (JSON)", [r[1] for r in results], labels),
        summarize("logprobs, 1 read", [d.distribution for d in one], labels),
        summarize("logprobs, 4 rotations", [d.distribution for d in four], labels),
        summarize(f"logprobs, 4 rotations + temperature ({temps[0]:.2f}/{temps[1]:.2f})",
                  [scaled[i] for i in range(len(tickets))], labels),
    ]
    for row in report:
        print(json.dumps(row))

    latencies = sorted(r[2] for r in results)
    cost = (decider.usage["prompt_tokens"] * INPUT_PRICE + decider.usage["completion_tokens"] * OUTPUT_PRICE) / 1e6
    print(json.dumps({
        "tickets": len(tickets),
        "mean_label_coverage": sum(d.coverage for d in four) / len(four),
        "decision_latency_p50_s": latencies[len(latencies) // 2],
        "decision_latency_p90_s": latencies[int(len(latencies) * 0.9)],
        "wall_seconds": wall,
        "decision_usage": decider.usage,
        "decision_cost_usd": cost,
        "cost_per_decision_usd": cost / len(tickets),
        "baseline_usage": BASELINE_USAGE,
    }))


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
