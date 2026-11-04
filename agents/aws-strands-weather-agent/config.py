"""Environment configuration for the Strands example."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1"


@dataclass(frozen=True)
class StrandsSettings:
    api_key: str
    model: str

    def model_kwargs(self) -> dict[str, object]:
        return {
            "client_args": {
                "api_key": self.api_key,
                "base_url": TOKEN_FACTORY_BASE_URL,
            },
            "model_id": self.model,
            "params": {
                "max_tokens": 512,
                "temperature": 0,
            },
        }


def load_settings(env: dict[str, str] | None = None) -> StrandsSettings:
    load_dotenv()
    values = os.environ if env is None else env
    missing = [
        name for name in ("NEBIUS_API_KEY", "NEBIUS_MODEL") if not values.get(name)
    ]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}"
        )
    return StrandsSettings(
        api_key=values["NEBIUS_API_KEY"], model=values["NEBIUS_MODEL"]
    )
