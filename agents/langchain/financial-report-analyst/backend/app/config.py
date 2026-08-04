from __future__ import annotations

import os
from pathlib import Path

DEFAULT_REASONING_MODEL = "nvidia/Nemotron-3-Ultra-550b-a55b"
DEFAULT_VISION_MODEL = "nvidia/Cosmos3-Super-Reasoner"
DEFAULT_REASONING_BASE_URL = "https://api.tokenfactory.us-central1.nebius.com/v1/"
DEFAULT_VISION_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"


def load_dotenv_if_present() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


load_dotenv_if_present()


class Settings:
    def __init__(self) -> None:
        self.app_dir = Path(__file__).resolve().parents[1]
        self.storage_root = Path(os.environ.get("FRA_STORAGE_ROOT", self.app_dir / "data")).resolve()
        self.database_url = os.environ.get(
            "FRA_DATABASE_URL",
            f"sqlite:///{self.storage_root / 'financial_report_analyst.db'}",
        )
        self.nebius_api_key = os.environ.get("NEBIUS_API_KEY", "")
        self.reasoning_model = os.environ.get("NEBIUS_REASONING_MODEL", DEFAULT_REASONING_MODEL)
        self.vision_model = os.environ.get("NEBIUS_VISION_MODEL", DEFAULT_VISION_MODEL)
        self.reasoning_base_url = os.environ.get("NEBIUS_REASONING_BASE_URL", DEFAULT_REASONING_BASE_URL)
        self.vision_base_url = os.environ.get("NEBIUS_VISION_BASE_URL", DEFAULT_VISION_BASE_URL)
        self.enable_model_calls = os.environ.get("FRA_ENABLE_MODEL_CALLS", "1") not in {"0", "false", "False"}
        self.max_vision_pages = int(os.environ.get("FRA_MAX_VISION_PAGES", "20"))
        self.model_timeout_seconds = float(os.environ.get("FRA_MODEL_TIMEOUT_SECONDS", "180"))
        self.checkpoint_db_path = Path(
            os.environ.get("FRA_CHECKPOINT_DB_PATH", self.storage_root / "deep_agent_checkpoints.sqlite")
        ).resolve()
        self.cors_origins = [
            origin.strip()
            for origin in os.environ.get("FRA_CORS_ORIGINS", "http://localhost:14321,http://127.0.0.1:14321").split(",")
            if origin.strip()
        ]


settings = Settings()
