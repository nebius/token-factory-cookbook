#!/usr/bin/env python3
"""Call Nebius Token Factory through Respan's OpenAI-compatible gateway."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import load_dotenv
from openai import OpenAI

TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
RESPAN_GATEWAY_BASE_URL = "https://api.respan.ai/api"
SUPPORTED_MODEL = "moonshotai/Kimi-K3"
PROVIDER_ID = "nebius-token-factory"
REFERENCE_CONFIG = Path(__file__).with_name("provider-config.example.json")


class ConfigurationError(ValueError):
    """Raised when required local or Respan provider configuration is invalid."""


def parse_boolean(name: str, value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be true or false")


@dataclass(frozen=True)
class Settings:
    respan_api_key: str
    model: str
    log_content: bool

    @classmethod
    def from_environment(cls, environ: Mapping[str, str]) -> Settings:
        api_key = environ.get("RESPAN_API_KEY", "").strip()
        model = environ.get("RESPAN_MODEL", "").strip()
        missing = [
            name
            for name, value in (("RESPAN_API_KEY", api_key), ("RESPAN_MODEL", model))
            if not value
        ]
        if missing:
            raise ConfigurationError(
                f"Missing required environment: {', '.join(missing)}"
            )
        if model != SUPPORTED_MODEL:
            raise ConfigurationError(
                f"RESPAN_MODEL must be {SUPPORTED_MODEL}; update the provider model "
                "registration and recipe validation together when changing models"
            )
        log_content = parse_boolean(
            "RESPAN_LOG_CONTENT", environ.get("RESPAN_LOG_CONTENT", "false")
        )
        return cls(api_key, model, log_content)


def load_and_validate_reference(path: Path = REFERENCE_CONFIG) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    provider = config.get("provider", {})
    model = config.get("model", {})
    application = config.get("application", {})

    expected_provider = {
        "type": "Custom / Self-hosted",
        "provider_id": PROVIDER_ID,
        "protocol": "OpenAI compatible",
        "base_url": TOKEN_FACTORY_BASE_URL,
        "api_key_source": "NEBIUS_API_KEY copied into Respan Provider settings",
    }
    for key, expected in expected_provider.items():
        if provider.get(key) != expected:
            raise ConfigurationError(f"provider.{key} must be {expected!r}")

    if model != {"id": SUPPORTED_MODEL, "provider_id": PROVIDER_ID}:
        raise ConfigurationError("model must map Kimi K3 to the Token Factory provider")
    if application != {
        "base_url": RESPAN_GATEWAY_BASE_URL,
        "api_key_env": "RESPAN_API_KEY",
        "request_path": "/chat/completions",
    }:
        raise ConfigurationError(
            "application must use Respan's Chat Completions gateway contract"
        )
    return config


def create_client(
    settings: Settings, *, http_client: httpx.Client | None = None
) -> OpenAI:
    return OpenAI(
        api_key=settings.respan_api_key,
        base_url=RESPAN_GATEWAY_BASE_URL,
        http_client=http_client,
    )


def create_chat_completion(client: OpenAI, settings: Settings, prompt: str) -> str:
    response = client.chat.completions.create(
        model=settings.model,
        messages=[{"role": "user", "content": prompt}],
        extra_body={
            "disable_log": not settings.log_content,
            "metadata": {
                "provider": PROVIDER_ID,
                "protocol": "chat-completions",
            },
        },
    )
    return response.choices[0].message.content or ""


def parse_args(arguments: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Call Token Factory through Respan Chat Completions"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate local and reference configuration without making a request",
    )
    parser.add_argument(
        "--prompt",
        default="Explain why tracing helps debug an LLM application in one sentence.",
    )
    return parser.parse_args(arguments)


def main(arguments: list[str] | None = None) -> int:
    load_dotenv()
    args = parse_args(arguments)
    try:
        settings = Settings.from_environment(os.environ)
        load_and_validate_reference()
    except (ConfigurationError, OSError, json.JSONDecodeError) as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2

    if args.check:
        content_mode = (
            "content logging enabled" if settings.log_content else "metrics only"
        )
        print(
            f"Configuration valid: {settings.model} via Respan Chat Completions "
            f"({content_mode})"
        )
        return 0

    client = create_client(settings)
    print(create_chat_completion(client, settings, args.prompt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
