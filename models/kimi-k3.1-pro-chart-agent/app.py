"""Read a bar chart with Kimi K3.1 Pro on Nebius Token Factory and record each bar through a tool.

The model receives the chart image and one declared tool, record_metric. It calls the tool once per
bar, the loop appends every result as a tool message, and the model finishes with a one-sentence
summary. Each assistant turn is sent back whole, including reasoning_content, as Moonshot recommends.
"""

import base64
import json
import os
import sys
from pathlib import Path

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
DEFAULT_MODEL = "moonshotai/Kimi-K3.1-Pro"
DEFAULT_IMAGE = str(Path(__file__).with_name("chart.png"))

TASK = (
    "Read every bar in this chart. Call record_metric once per bar with its label, its value and the "
    "unit from the title or axis. After all bars are recorded, answer in one sentence naming the "
    "largest and the smallest bar."
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "record_metric",
            "description": "Record one value read from the chart.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Bar label exactly as printed on the chart"},
                    "value": {"type": "number", "description": "Numeric value of the bar"},
                    "unit": {"type": "string", "description": "Unit shown on the chart, or an empty string"},
                },
                "required": ["name", "value", "unit"],
            },
        },
    }
]


def image_part(source: str) -> dict:
    """Return an image_url content part for a public URL or a local file."""
    if source.startswith(("http://", "https://")):
        return {"type": "image_url", "image_url": {"url": source}}
    encoded = base64.b64encode(Path(source).read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}}


def record_metric(name: str, value: float, unit: str) -> dict:
    print(f"recorded {name}: {value} {unit}".rstrip())
    return {"ok": True, "name": name, "value": value, "unit": unit}


def assistant_turn(message) -> dict:
    """Rebuild the assistant message so it can be sent back whole, reasoning included."""
    turn = {"role": "assistant", "content": message.content or ""}
    reasoning = (message.model_extra or {}).get("reasoning_content")
    if reasoning:
        turn["reasoning_content"] = reasoning
    if message.tool_calls:
        turn["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.function.name, "arguments": call.function.arguments},
            }
            for call in message.tool_calls
        ]
    return turn


def add_usage(totals: dict, usage) -> None:
    if usage is None:
        return
    totals["prompt_tokens"] += usage.prompt_tokens or 0
    totals["completion_tokens"] += usage.completion_tokens or 0
    details = getattr(usage, "completion_tokens_details", None)
    totals["reasoning_tokens"] += (getattr(details, "reasoning_tokens", None) or 0) if details else 0


def run(client, model: str, image_source: str, reasoning_effort: str | None = None, max_rounds: int = 8):
    messages = [{"role": "user", "content": [{"type": "text", "text": TASK}, image_part(image_source)]}]
    extra_body = {"reasoning_effort": reasoning_effort} if reasoning_effort else {}
    totals = {"prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0}
    recorded = []

    for _ in range(max_rounds):
        response = client.chat.completions.create(
            model=model, messages=messages, tools=TOOLS, max_tokens=4000, extra_body=extra_body
        )
        message = response.choices[0].message
        add_usage(totals, response.usage)
        messages.append(assistant_turn(message))
        if not message.tool_calls:
            return message.content or "", recorded, totals
        for call in message.tool_calls:
            if call.function.name == "record_metric":
                result = record_metric(**json.loads(call.function.arguments))
                recorded.append(result)
            else:
                result = {"error": f"unknown tool {call.function.name}; only record_metric is available"}
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)})

    raise RuntimeError(f"the model was still calling tools after {max_rounds} rounds")


def main(argv=None, client=None) -> int:
    if client is None:
        from openai import OpenAI

        client = OpenAI(
            api_key=os.environ["NEBIUS_API_KEY"],
            base_url=os.environ.get("NEBIUS_BASE_URL", DEFAULT_BASE_URL),
        )
    model = os.environ.get("NEBIUS_MODEL", DEFAULT_MODEL)
    image_source = os.environ.get("CHART_IMAGE", DEFAULT_IMAGE)
    effort = os.environ.get("KIMI_REASONING_EFFORT") or None

    answer, recorded, totals = run(client, model, image_source, reasoning_effort=effort)
    print(f"Kimi response: {answer}")
    print(
        f"usage: prompt={totals['prompt_tokens']} completion={totals['completion_tokens']} "
        f"reasoning={totals['reasoning_tokens']} metrics={len(recorded)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
