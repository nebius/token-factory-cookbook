"""The ops agent: Kimi plans, calls tools for evidence, and answers in plain language.

A standard tool-calling loop on the Chat Completions API. The model never sees names or emails,
can't send anything, and stops after MAX_STEPS rounds of tool calls.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import tools
from event import Event

MAX_STEPS = 6

SYSTEM = """You are the ops assistant for a conference's organizers. You answer questions about check-in
and sponsor booth leads using only the tools you have. Rules:
- Call tools to get evidence before answering. Never guess numbers.
- Quote what you found: counts, booth ids, times (venue time, HH:MM), badge ids.
- Scans that "synced late" were made while a scanner was offline and were stored exactly once when it
  reconnected; they are not lost.
- You can't see names or emails, and must not ask for them.
- You can draft a message to a sponsor with draft_sponsor_message. It is only a draft; say that a person
  must approve it. Never claim anything was sent.
- Be brief: a short paragraph or a few bullets."""


@dataclass
class Step:
    tool: str
    arguments: dict
    result: dict


@dataclass
class Answer:
    text: str
    model: str
    steps: list[Step] = field(default_factory=list)
    stopped_early: bool = False


def ask(client, model: str, ev: Event, question: str, history: list[dict] | None = None) -> Answer:
    messages = [{"role": "system", "content": SYSTEM}, *(history or []), {"role": "user", "content": question}]
    steps: list[Step] = []
    for _ in range(MAX_STEPS):
        resp = client.chat.completions.create(model=model, messages=messages, tools=tools.SCHEMAS, tool_choice="auto", temperature=0.2)
        msg = resp.choices[0].message
        calls = getattr(msg, "tool_calls", None) or []
        if not calls:
            return Answer(text=msg.content or "", model=model, steps=steps)
        assistant_calls = []
        tool_results = []
        for c in calls:
            try:
                args = tools.parse_arguments(c.function.arguments)
                replay_arguments = json.dumps(args, allow_nan=False)
            except (ValueError, TypeError):
                args = {"raw": c.function.arguments}
                # Token Factory requires JSON objects even in assistant history.
                # Repair only the replay; the tool still receives the bad input.
                replay_arguments = "{}"
            assistant_calls.append({"id": c.id, "type": "function", "function": {
                "name": c.function.name, "arguments": replay_arguments,
            }})
            out = tools.call(ev, c.function.name, c.function.arguments)
            steps.append(Step(c.function.name, args, json.loads(out)))
            tool_results.append({"role": "tool", "tool_call_id": c.id, "content": out})
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": assistant_calls})
        messages.extend(tool_results)
    return Answer(text="I stopped after the maximum number of tool calls. Here is what I gathered so far: see the steps below.",
                  model=model, steps=steps, stopped_early=True)
