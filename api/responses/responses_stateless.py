"""Minimal stateless Responses API example for Nebius Token Factory."""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any

from openai import OpenAI, OpenAIError

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"


def create_client(api_key: str, base_url: str = DEFAULT_BASE_URL) -> OpenAI:
    """Create an OpenAI client pointed at Token Factory."""
    return OpenAI(api_key=api_key, base_url=base_url)


def create_stateless_response(client: Any, model: str, prompt: str) -> Any:
    """Create an independent first-turn response without server-side state."""
    response = client.responses.create(
        model=model,
        input=prompt,
        store=False,
    )
    require_completed(response)
    return response


def require_completed(response: Any) -> None:
    status = getattr(response, "status", None)
    if status != "completed":
        raise RuntimeError(f"Response did not complete (status: {status}).")


def stream_stateless_response(client: Any, model: str, prompt: str) -> str:
    """Stream text deltas from an independent first-turn response."""
    chunks: list[str] = []
    completed = False
    with client.responses.create(
        model=model,
        input=prompt,
        store=False,
        stream=True,
    ) as events:
        for event in events:
            if event.type == "response.output_text.delta":
                chunks.append(event.delta)
                print(event.delta, end="", flush=True)
            elif event.type == "response.completed":
                require_completed(event.response)
                completed = True
            elif event.type in {"response.failed", "response.incomplete", "error"}:
                raise RuntimeError(f"Response stream failed ({event.type}).")
    print()
    if not completed:
        raise RuntimeError("Response stream ended before response.completed.")
    return "".join(chunks)


def required_environment() -> tuple[str, str]:
    api_key = os.getenv("NEBIUS_API_KEY", "").strip()
    model = os.getenv("NEBIUS_MODEL", "").strip()
    missing = [
        name
        for name, value in (("NEBIUS_API_KEY", api_key), ("NEBIUS_MODEL", model))
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variable(s): {', '.join(missing)}"
        )
    return api_key, model


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "prompt", nargs="?", default="Explain stateless APIs in one sentence."
    )
    parser.add_argument("--stream", action="store_true", help="Stream text deltas.")
    args = parser.parse_args()

    try:
        api_key, model = required_environment()
        with create_client(
            api_key, os.getenv("NEBIUS_BASE_URL", DEFAULT_BASE_URL)
        ) as client:
            if args.stream:
                stream_stateless_response(client, model, args.prompt)
            else:
                response = create_stateless_response(client, model, args.prompt)
                print(response.output_text)
    except (OpenAIError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
