import os
from collections.abc import Mapping
from dataclasses import dataclass

TOKEN_FACTORY_API_BASE = "https://api.tokenfactory.nebius.com/v1"


@dataclass(frozen=True)
class TokenFactoryConfig:
    api_key: str
    model_id: str

    def litellm_kwargs(self) -> dict[str, str]:
        return {
            "model": f"openai/{self.model_id}",
            "api_base": TOKEN_FACTORY_API_BASE,
            "api_key": self.api_key,
        }


def load_token_factory_config(
    environment: Mapping[str, str] | None = None,
) -> TokenFactoryConfig:
    source = os.environ if environment is None else environment
    api_key = source.get("NEBIUS_API_KEY", "").strip()
    model_id = source.get("NEBIUS_MODEL", "").strip()

    missing = [
        name
        for name, value in (("NEBIUS_API_KEY", api_key), ("NEBIUS_MODEL", model_id))
        if not value
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variable(s): {', '.join(missing)}"
        )

    return TokenFactoryConfig(api_key=api_key, model_id=model_id)
