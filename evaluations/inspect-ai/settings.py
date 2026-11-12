"""Validated runtime settings for the Token Factory Inspect example."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1"


@dataclass(frozen=True)
class TokenFactorySettings:
    """The required Token Factory values and their Inspect representation."""

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
            names = ", ".join(missing)
            raise RuntimeError(f"Missing required environment variable(s): {names}")

        return cls(
            api_key=values["NEBIUS_API_KEY"].strip(),
            model_id=values["NEBIUS_MODEL"].strip(),
        )

    @property
    def inspect_model(self) -> str:
        """Select Inspect's generic OpenAI provider without changing the model ID."""

        return f"openai/{self.model_id}"

    def configure_openai_provider(self) -> None:
        """Map Token Factory credentials to Inspect's OpenAI provider variables."""

        os.environ["OPENAI_API_KEY"] = self.api_key
        os.environ["OPENAI_BASE_URL"] = TOKEN_FACTORY_BASE_URL
