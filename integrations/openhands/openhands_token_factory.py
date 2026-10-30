"""Launch OpenHands with a validated Nebius Token Factory configuration."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1"


@dataclass(frozen=True)
class TokenFactorySettings:
    api_key: str
    model_id: str

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> TokenFactorySettings:
        values = os.environ if environ is None else environ
        missing = [
            name
            for name in ("NEBIUS_API_KEY", "NEBIUS_MODEL")
            if not values.get(name, "").strip()
        ]
        if missing:
            raise RuntimeError(
                "Missing required environment variable(s): " + ", ".join(missing)
            )

        model_id = values["NEBIUS_MODEL"].strip()
        if model_id.startswith("openai/openai/"):
            raise RuntimeError(
                "NEBIUS_MODEL must be a Token Factory model ID, for example "
                "openai/gpt-oss-120b; do not include OpenHands' provider prefix"
            )
        if "/" not in model_id:
            raise RuntimeError(
                "NEBIUS_MODEL must be a slash-qualified Token Factory model ID"
            )

        return cls(
            api_key=values["NEBIUS_API_KEY"].strip(),
            model_id=model_id,
        )

    @property
    def litellm_model(self) -> str:
        """Prefix the unchanged Token Factory ID with LiteLLM's provider."""

        return f"openai/{self.model_id}"

    def openhands_environment(
        self, environ: Mapping[str, str] | None = None
    ) -> dict[str, str]:
        """Return a launch environment using OpenHands' supported overrides."""

        result = dict(os.environ if environ is None else environ)
        result.update(
            {
                "LLM_API_KEY": self.api_key,
                "LLM_BASE_URL": TOKEN_FACTORY_BASE_URL,
                "LLM_MODEL": self.litellm_model,
            }
        )
        return result


def openhands_command(arguments: Sequence[str]) -> list[str]:
    """Build the CLI command that makes environment overrides authoritative."""

    return ["openhands", "--override-with-envs", *arguments]


def validate(settings: TokenFactorySettings) -> None:
    """Print only non-secret resolved values for an offline configuration check."""

    print("Token Factory configuration is valid.")
    print(f"LLM_MODEL={settings.litellm_model}")
    print(f"LLM_BASE_URL={TOKEN_FACTORY_BASE_URL}")
    print("Transport=Chat Completions")


def main(arguments: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if arguments is None else arguments)
    settings = TokenFactorySettings.from_env()

    if args == ["--check"]:
        validate(settings)
        return 0

    if args[:1] == ["--"]:
        args = args[1:]

    if shutil.which("openhands") is None:
        raise RuntimeError(
            "OpenHands is not installed; run: uv tool install openhands --python 3.12"
        )

    completed = subprocess.run(
        openhands_command(args),
        env=settings.openhands_environment(),
        check=False,
    )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
