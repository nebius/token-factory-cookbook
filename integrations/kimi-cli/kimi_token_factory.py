#!/usr/bin/env python3
"""Validate and launch Kimi CLI against Nebius Token Factory."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import tomllib

BASE_URL = "https://api.tokenfactory.nebius.com/v1"
MODEL_PLACEHOLDER = "__NEBIUS_MODEL__"
PROVIDER_KEY = "token-factory"
SUPPORTED_MODEL = "moonshotai/Kimi-K3"
TEMPLATE_PATH = Path(__file__).with_name("config.template.toml")


class ConfigurationError(ValueError):
    """Raised when the local recipe or required environment is invalid."""


def require_environment(environ: dict[str, str] | os._Environ[str]) -> tuple[str, str]:
    api_key = environ.get("NEBIUS_API_KEY", "").strip()
    model = environ.get("NEBIUS_MODEL", "").strip()
    missing = [
        name
        for name, value in (("NEBIUS_API_KEY", api_key), ("NEBIUS_MODEL", model))
        if not value
    ]
    if missing:
        raise ConfigurationError(f"Missing required environment: {', '.join(missing)}")
    if model != SUPPORTED_MODEL:
        raise ConfigurationError(
            f"NEBIUS_MODEL must be {SUPPORTED_MODEL}; this recipe's context and "
            "capability declarations are validated for that model"
        )
    return api_key, model


def load_and_validate_template(path: Path = TEMPLATE_PATH) -> tuple[str, dict]:
    template = path.read_text(encoding="utf-8")
    config = tomllib.loads(template)

    if config.get("default_model") != PROVIDER_KEY:
        raise ConfigurationError("default_model must select token-factory")

    provider = config.get("providers", {}).get(PROVIDER_KEY, {})
    if provider.get("type") != "openai_legacy":
        raise ConfigurationError(
            "Token Factory must use Kimi CLI's openai_legacy Chat Completions provider"
        )
    if provider.get("base_url") != BASE_URL:
        raise ConfigurationError(f"base_url must be {BASE_URL}")
    if provider.get("api_key") != "overridden-by-OPENAI_API_KEY":
        raise ConfigurationError("the template must not contain a real API key")

    model = config.get("models", {}).get(PROVIDER_KEY, {})
    if model.get("provider") != PROVIDER_KEY or model.get("model") != MODEL_PLACEHOLDER:
        raise ConfigurationError(
            "the model must reference the provider and model placeholder"
        )
    if model.get("max_context_size") != 1_000_000:
        raise ConfigurationError(f"{SUPPORTED_MODEL} max_context_size must be 1000000")

    return template, config


def render_config(model: str, path: Path = TEMPLATE_PATH) -> str:
    template, _ = load_and_validate_template(path)
    if template.count(MODEL_PLACEHOLDER) != 1:
        raise ConfigurationError(
            "the template must contain exactly one model placeholder"
        )
    return template.replace(MODEL_PLACEHOLDER, model)


def build_command(config_path: Path, arguments: list[str]) -> list[str]:
    return ["kimi", "--config-file", str(config_path), *arguments]


def parse_args(arguments: list[str] | None = None) -> tuple[bool, list[str]]:
    parser = argparse.ArgumentParser(
        description="Launch Kimi CLI with Nebius Token Factory",
        add_help=True,
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate environment and config without launching Kimi CLI",
    )
    parsed, passthrough = parser.parse_known_args(arguments)
    return parsed.check, passthrough


def main(arguments: list[str] | None = None) -> int:
    check_only, passthrough = parse_args(arguments)
    try:
        api_key, model = require_environment(os.environ)
        rendered = render_config(model)
    except (ConfigurationError, OSError, tomllib.TOMLDecodeError) as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2

    if check_only:
        print(f"Configuration valid: {model} via Chat Completions at {BASE_URL}")
        return 0

    if shutil.which("kimi") is None:
        print(
            "Kimi CLI is not installed; follow the README installation step.",
            file=sys.stderr,
        )
        return 127

    child_environment = os.environ.copy()
    child_environment["OPENAI_API_KEY"] = api_key
    child_environment["OPENAI_BASE_URL"] = BASE_URL

    with tempfile.TemporaryDirectory(prefix="kimi-token-factory-") as directory:
        config_path = Path(directory) / "config.toml"
        config_path.write_text(rendered, encoding="utf-8")
        completed = subprocess.run(
            build_command(config_path, passthrough),
            env=child_environment,
            check=False,
        )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
