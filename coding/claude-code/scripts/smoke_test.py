"""Check that the local proxy speaks enough of the Anthropic Messages API for Claude Code.

    uv run --env-file .env python scripts/smoke_test.py

For every model the proxy serves it runs the four things Claude Code depends on:
a plain message, a streamed message, a streamed tool call, and token counting.
Run it after starting the proxy and before launching Claude Code; a model that
fails the streamed tool call here will fail inside Claude Code too.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

PORT = os.environ.get("LITELLM_PORT", "").strip() or "4000"
BASE = f"http://127.0.0.1:{PORT}"
KEY = os.environ.get("LITELLM_MASTER_KEY", "").strip()
MAX_TOKENS = 1024  # always explicit: Token Factory silently defaults to 8192 otherwise

WEATHER_TOOL = {
    "name": "get_weather",
    "description": "Get the current weather for a city.",
    "input_schema": {
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
    },
}


def call(path: str, body: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {KEY}",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()
    except urllib.error.URLError as exc:
        sys.exit(f"Cannot reach the proxy at {BASE}: {exc.reason}. Is start_proxy.sh running?")


def sse_events(raw: str) -> list[dict]:
    events = []
    for line in raw.splitlines():
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload and payload != "[DONE]":
                events.append(json.loads(payload))
    return events


def stream_error(events: list[dict]) -> str | None:
    """A failed generation still returns HTTP 200; the error is an event in the stream."""
    for event in events:
        if event.get("type") == "error" or "error" in event:
            return json.dumps(event.get("error", event))[:200]
    return None


def check_message(model: str) -> str:
    status, raw = call(
        "/v1/messages",
        {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
        },
    )
    if status != 200:
        return f"FAIL HTTP {status}: {raw[:160]}"
    body = json.loads(raw)
    text = "".join(b.get("text", "") for b in body["content"] if b["type"] == "text")
    return "PASS" if text.strip() else f"FAIL empty text, stop_reason={body.get('stop_reason')}"


def check_stream(model: str) -> str:
    status, raw = call(
        "/v1/messages",
        {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "stream": True,
            "messages": [{"role": "user", "content": "Count from 1 to 5."}],
        },
    )
    if status != 200:
        return f"FAIL HTTP {status}: {raw[:160]}"
    events = sse_events(raw)
    if err := stream_error(events):
        return f"FAIL error inside stream: {err}"
    kinds = [e.get("type") for e in events]
    if kinds[:1] != ["message_start"] or kinds[-1:] != ["message_stop"]:
        return f"FAIL bad event order: {kinds[:2]} ... {kinds[-2:]}"
    usage = next((e["usage"] for e in reversed(events) if e.get("type") == "message_delta"), {})
    return f"PASS ({kinds.count('content_block_delta')} deltas, usage {usage.get('input_tokens')}/{usage.get('output_tokens')})"


def check_stream_tool(model: str) -> str:
    status, raw = call(
        "/v1/messages",
        {
            "model": model,
            "max_tokens": MAX_TOKENS,
            "stream": True,
            "tools": [WEATHER_TOOL],
            "messages": [{"role": "user", "content": "What is the weather in Nairobi? Use the tool."}],
        },
    )
    if status != 200:
        return f"FAIL HTTP {status}: {raw[:160]}"
    events = sse_events(raw)
    if err := stream_error(events):
        return f"FAIL error inside stream: {err}"
    blocks: dict[int, dict] = {}
    for event in events:
        if event.get("type") == "content_block_start" and event["content_block"]["type"] == "tool_use":
            blocks[event["index"]] = {"name": event["content_block"]["name"], "json": ""}
        elif event.get("type") == "content_block_delta" and event["delta"]["type"] == "input_json_delta":
            if event["index"] in blocks:
                blocks[event["index"]]["json"] += event["delta"]["partial_json"]
    if not blocks:
        return "FAIL no tool_use block in stream"
    for block in blocks.values():
        try:
            args = json.loads(block["json"] or "{}")
        except json.JSONDecodeError:
            return f"FAIL tool arguments are not valid JSON: {block['json']!r}"
        if not args.get("city"):
            return f"FAIL tool arguments missing 'city': {block['json']!r}"
    first = json.dumps(json.loads(next(iter(blocks.values()))["json"]))
    return f"PASS ({len(blocks)} tool call, args {first})"


def check_count_tokens(model: str) -> str:
    status, raw = call(
        "/v1/messages/count_tokens",
        {"model": model, "messages": [{"role": "user", "content": "Count these tokens."}]},
    )
    if status != 200:
        return f"FAIL HTTP {status}: {raw[:160]}"
    return f"PASS ({json.loads(raw).get('input_tokens')} tokens)"


def main() -> None:
    if not KEY:
        sys.exit("LITELLM_MASTER_KEY is not set. Run with: uv run --env-file .env python scripts/smoke_test.py")
    status, raw = call("/v1/models")
    if status != 200:
        sys.exit(f"GET /v1/models failed: HTTP {status} {raw[:200]}")
    models = [m["id"] for m in json.loads(raw)["data"]]
    print(f"proxy at {BASE} serves {len(models)} model(s)\n")
    failed = False
    for model in models:
        print(model)
        for label, check in (
            ("message", check_message),
            ("stream", check_stream),
            ("stream + tool call", check_stream_tool),
            ("count_tokens", check_count_tokens),
        ):
            result = check(model)
            failed |= result.startswith("FAIL")
            print(f"  {label:20} {result}")
        print()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
