"""Model clients: an OpenAI-compatible client for Nebius Token Factory, and a labelled fixture double.

The live client never stores or returns the model's private reasoning (`reasoning_content`).
Only the visible message text and the tool calls reach the timeline.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import httpx
import openai

from .settings import Settings

FIXTURE_PROVIDER = "fixture"
FIXTURE_LABEL = "FIXTURE: scripted test double, not a model"


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # raw JSON text, validated by the tool layer


@dataclass
class ModelResponse:
    content: str
    tool_calls: list[ToolCall]
    finish_reason: str | None
    usage: dict[str, int] | None  # from the provider; None when it reports none
    latency_s: float
    model: str


class ModelError(Exception):
    pass


class ModelClient(Protocol):
    provider: str
    model: str

    def generation_settings(self) -> dict[str, Any]: ...

    def chat(self, messages: list[dict], tools: list[dict]) -> ModelResponse: ...


class OpenAICompatibleModel:
    """Any OpenAI-compatible chat completions endpoint. Defaults to Nebius Token Factory."""

    provider = "nebius-token-factory"

    def __init__(self, settings: Settings) -> None:
        if not settings.nebius_model:
            raise ModelError("NEBIUS_MODEL is not set. Set it to an exact model id from the Token Factory catalog.")
        if not settings.nebius_api_key:
            raise ModelError("NEBIUS_API_KEY is not set.")
        self.model = settings.nebius_model
        self.settings = settings
        self.client = openai.OpenAI(
            base_url=settings.nebius_base_url,
            api_key=settings.nebius_api_key,
            timeout=httpx.Timeout(120.0, connect=10.0),
            max_retries=0,  # retries are ours, so they are counted and visible
        )

    def generation_settings(self) -> dict[str, Any]:
        out: dict[str, Any] = {"max_tokens": self.settings.model_max_tokens}
        if self.settings.model_temperature is not None:
            out["temperature"] = self.settings.model_temperature
        if self.settings.model_reasoning_effort:
            out["reasoning_effort"] = self.settings.model_reasoning_effort
        return out

    def chat(self, messages: list[dict], tools: list[dict]) -> ModelResponse:
        last_error: Exception | None = None
        for attempt in range(self.settings.max_model_retries + 1):
            started = time.monotonic()
            try:
                resp = self.client.chat.completions.create(
                    model=self.model, messages=messages, tools=tools or openai.NOT_GIVEN,
                    tool_choice="auto" if tools else openai.NOT_GIVEN, **self.generation_settings(),
                )
            except (openai.RateLimitError, openai.APIConnectionError, openai.APITimeoutError,
                    openai.InternalServerError) as exc:
                last_error = exc
                time.sleep(min(2 ** attempt, 8))
                continue
            except openai.APIStatusError as exc:
                raise ModelError(f"{exc.status_code}: {_error_message(exc)}") from exc
            choice = resp.choices[0]
            msg = choice.message
            calls = [ToolCall(id=c.id, name=c.function.name, arguments=c.function.arguments or "{}")
                     for c in (msg.tool_calls or []) if c.type == "function"]
            usage = None
            if resp.usage:
                usage = {"prompt_tokens": resp.usage.prompt_tokens or 0,
                         "completion_tokens": resp.usage.completion_tokens or 0,
                         "total_tokens": resp.usage.total_tokens or 0}
            return ModelResponse(content=msg.content or "", tool_calls=calls, finish_reason=choice.finish_reason,
                                 usage=usage, latency_s=time.monotonic() - started, model=resp.model or self.model)
        raise ModelError(f"model request failed after {self.settings.max_model_retries + 1} attempts: {last_error}")


def _error_message(exc: openai.APIStatusError) -> str:
    try:
        body = exc.response.json()
        return body.get("error", {}).get("message") or body.get("detail") or exc.message
    except Exception:  # noqa: BLE001
        return exc.message


FixtureStep = Callable[[list[dict]], ModelResponse]


@dataclass
class FixtureModel:
    """A scripted stand-in for the model, for UI development and automated tests.

    Runs that use it are stored with provenance "fixture" and labelled in every view and report.
    """

    script: list[FixtureStep]
    model: str = "fixture-script"
    provider: str = FIXTURE_PROVIDER
    position: int = field(default=0)

    def generation_settings(self) -> dict[str, Any]:
        return {"note": FIXTURE_LABEL}

    def chat(self, messages: list[dict], tools: list[dict]) -> ModelResponse:
        if self.position >= len(self.script):
            return ModelResponse("", [ToolCall("fx-end", "finish", json.dumps(
                {"outcome": "escalate", "root_cause": "fixture script exhausted", "summary": "fixture script exhausted"}))],
                "tool_calls", None, 0.0, self.model)
        step = self.script[self.position]
        self.position += 1
        return step(messages)


def fixture_call(name: str, args: dict | Callable[[list[dict]], dict], note: str = "") -> FixtureStep:
    """One scripted turn: optional visible text, then one tool call."""

    def step(messages: list[dict]) -> ModelResponse:
        resolved = args(messages) if callable(args) else args
        return ModelResponse(note, [ToolCall(f"fx-{name}-{len(messages)}", name, json.dumps(resolved))],
                             "tool_calls", None, 0.0, "fixture-script")

    return step


def last_tool_result(messages: list[dict], tool_name: str) -> dict:
    """The most recent result of a tool, for fixture steps that depend on earlier output."""
    ids = {}
    for m in messages:
        for c in m.get("tool_calls") or []:
            ids[c["id"]] = c["function"]["name"]
    for m in reversed(messages):
        if m.get("role") == "tool" and ids.get(m.get("tool_call_id")) == tool_name:
            try:
                return json.loads(m["content"])
            except (ValueError, TypeError):
                return {}
    return {}


PREFLIGHT_TOOL = {
    "type": "function",
    "function": {
        "name": "report_status",
        "description": "Report the health of a named service.",
        "parameters": {
            "type": "object",
            "properties": {"service": {"type": "string"}, "healthy": {"type": "boolean"}},
            "required": ["service", "healthy"],
        },
    },
}


def preflight(settings: Settings) -> dict[str, Any]:
    """Check authentication, model access and the tool-calling round trip the agent needs."""
    checks: list[dict[str, Any]] = []
    result: dict[str, Any] = {"provider": "nebius-token-factory", "base_url": settings.nebius_base_url,
                              "model": settings.nebius_model or None, "checks": checks, "ok": False}

    def check(name: str, ok: bool, detail: str) -> bool:
        checks.append({"name": name, "ok": ok, "detail": detail})
        return ok

    if not check("configuration", bool(settings.nebius_api_key and settings.nebius_model),
                 "NEBIUS_API_KEY and NEBIUS_MODEL are set" if settings.nebius_api_key and settings.nebius_model
                 else "Set NEBIUS_API_KEY and NEBIUS_MODEL (an exact id from the Token Factory catalog)."):
        return result
    client = openai.OpenAI(base_url=settings.nebius_base_url, api_key=settings.nebius_api_key,
                           timeout=httpx.Timeout(60.0, connect=10.0), max_retries=1)
    try:
        ids = [m.id for m in client.models.list().data]
    except openai.AuthenticationError:
        check("authentication", False, "The endpoint rejected NEBIUS_API_KEY (401).")
        return result
    except openai.APIError as exc:
        check("authentication", False, f"Could not list models: {exc}")
        return result
    check("authentication", True, f"Key accepted; the catalog lists {len(ids)} models.")
    if not check("model access", settings.nebius_model in ids,
                 f"{settings.nebius_model} is in the catalog." if settings.nebius_model in ids else
                 f"{settings.nebius_model} is not in this key's catalog. Pick an exact id from GET /models."):
        result["catalog_sample"] = sorted(ids)[:40]
        return result
    model = OpenAICompatibleModel(settings)
    messages = [{"role": "system", "content": "Call the report_status tool exactly once."},
                {"role": "user", "content": "The checkout service is healthy. Report it."}]
    try:
        first = model.chat(messages, [PREFLIGHT_TOOL])
    except ModelError as exc:
        check("tool calling", False, f"Request with tools failed: {exc}")
        return result
    if not first.tool_calls:
        check("tool calling", False, "The model answered without calling the tool; the agent needs native tool calls.")
        return result
    call = first.tool_calls[0]
    try:
        args = json.loads(call.arguments)
        valid = call.name == "report_status" and isinstance(args.get("healthy"), bool)
    except ValueError:
        valid = False
    if not check("tool calling", valid, f"Returned {call.name}({call.arguments}) in {first.latency_s:.1f} s"
                 if valid else f"Malformed tool call: {call.name}({call.arguments})"):
        return result
    messages += [{"role": "assistant", "content": first.content, "tool_calls": [
        {"id": call.id, "type": "function", "function": {"name": call.name, "arguments": call.arguments}}]},
                 {"role": "tool", "tool_call_id": call.id, "content": json.dumps({"recorded": True})}]
    try:
        second = model.chat(messages, [PREFLIGHT_TOOL])
    except ModelError as exc:
        check("tool result round trip", False, f"Follow-up after a tool result failed: {exc}")
        return result
    check("tool result round trip", True, f"Model continued after the tool result in {second.latency_s:.1f} s.")
    check("token usage", second.usage is not None,
          "The provider reports token usage." if second.usage else "No usage reported; token budgets cannot be enforced.")
    result["generation_settings"] = model.generation_settings()
    result["ok"] = all(c["ok"] for c in checks if c["name"] != "token usage")
    return result
