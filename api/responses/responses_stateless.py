"""Minimal stateless Responses API example for Nebius Token Factory."""

from __future__ import annotations

import argparse
import os
from typing import Any

from openai import OpenAI


DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
EXPECTED_UNSUPPORTED_STATUS_CODES = {400, 404, 422}


def create_client(api_key: str, base_url: str = DEFAULT_BASE_URL) -> OpenAI:
    """Create an OpenAI client pointed at Token Factory."""
    return OpenAI(api_key=api_key, base_url=base_url)


def create_stateless_response(client: Any, model: str, prompt: str) -> Any:
    """Create an independent first-turn response without server-side state."""
    return client.responses.create(
        model=model,
        input=prompt,
        store=False,
    )


def stream_stateless_response(client: Any, model: str, prompt: str) -> str:
    """Stream text deltas from an independent first-turn response."""
    chunks: list[str] = []
    events = client.responses.create(
        model=model,
        input=prompt,
        store=False,
        stream=True,
    )
    for event in events:
        if getattr(event, "type", None) == "response.output_text.delta":
            delta = getattr(event, "delta", "")
            chunks.append(delta)
            print(delta, end="", flush=True)
    print()
    return "".join(chunks)


def probe_unsupported_continuation(client: Any, model: str, response_id: str) -> int:
    """Confirm that server-side continuation is rejected by the current API contract.

    This opt-in probe makes a billable API request. It succeeds only when the API
    rejects ``previous_response_id`` with a client error. An accepted request is
    treated as a contract change that requires the example and tests to be updated.
    """
    try:
        client.responses.create(
            model=model,
            input="Continue with one more sentence.",
            previous_response_id=response_id,
            store=False,
        )
    except Exception as exc:
        status_code = getattr(exc, "status_code", None)
        if status_code in EXPECTED_UNSUPPORTED_STATUS_CODES:
            return status_code
        raise
    raise RuntimeError(
        "previous_response_id was accepted; the Responses API contract may have changed"
    )


def required_environment() -> tuple[str, str]:
    api_key = os.getenv("NEBIUS_API_KEY", "").strip()
    model = os.getenv("NEBIUS_MODEL", "").strip()
    missing = [name for name, value in (("NEBIUS_API_KEY", api_key), ("NEBIUS_MODEL", model)) if not value]
    if missing:
        raise RuntimeError(f"Missing required environment variable(s): {', '.join(missing)}")
    return api_key, model


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", nargs="?", default="Explain stateless APIs in one sentence.")
    parser.add_argument("--stream", action="store_true", help="Stream text deltas.")
    parser.add_argument(
        "--probe-unsupported",
        action="store_true",
        help="Make a second, billable request that must reject previous_response_id.",
    )
    args = parser.parse_args()
    if args.stream and args.probe_unsupported:
        parser.error("--probe-unsupported cannot be combined with --stream")

    api_key, model = required_environment()
    client = create_client(api_key, os.getenv("NEBIUS_BASE_URL", DEFAULT_BASE_URL))
    if args.stream:
        stream_stateless_response(client, model, args.prompt)
        return 0

    response = create_stateless_response(client, model, args.prompt)
    print(response.output_text)
    if args.probe_unsupported:
        status = probe_unsupported_continuation(client, model, response.id)
        print(f"Continuation rejected as expected (HTTP {status}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
