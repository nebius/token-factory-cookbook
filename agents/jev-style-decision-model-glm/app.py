"""Route one support ticket with typed, probabilistic decisions."""

from __future__ import annotations

import json
import sys
import time

from decider import Decider, Question

AUTO_ROUTE_AT = 0.9

TEAMS = (
    "Teams:\n"
    "- billing: charges, refunds, invoices, payment methods, tax, renewals of an existing plan\n"
    "- technical: bugs, errors, outages, API, SDK and integration problems\n"
    "- account: login, access, users, roles, workspace settings, personal data\n"
    "- sales: new purchases, upgrades, quotes, demos, trials, contracts, procurement and security reviews"
)

QUESTIONS = [
    Question.choice("team", f"{TEAMS}\n\nWhich team should handle this ticket?",
                    ["billing", "technical", "account", "sales"]),
    Question.yes_no("urgent", "Is the customer blocked from using the product right now?"),
    Question.score("frustration", "How frustrated is the customer, from 1 (calm) to 5 (furious)?"),
]


def main() -> None:
    ticket = sys.argv[1] if len(sys.argv) > 1 else (
        "Our checkout has been failing with a 500 error since this morning and "
        "customers can't pay. This is the second outage this week."
    )
    decider = Decider()

    start = time.perf_counter()
    decisions = decider.decide(f"Ticket: {ticket}", QUESTIONS)
    elapsed = time.perf_counter() - start

    team = decisions["team"]
    action = f"route to {team.answer}" if team.probability >= AUTO_ROUTE_AT else "escalate to a human triager"
    output = {
        name: {
            "answer": d.answer,
            "probability": round(d.probability, 3),
            "distribution": {k: round(v, 3) for k, v in d.distribution.items()},
            **({"expected": round(d.expected, 2)} if d.expected is not None else {}),
        }
        for name, d in decisions.items()
    }
    print(json.dumps(output, indent=2))
    print(f"Requests: {decider.usage['requests']}, prompt tokens: {decider.usage['prompt_tokens']}, "
          f"latency: {elapsed:.2f}s")
    print(f"Decision: {action}")


if __name__ == "__main__":
    main()
