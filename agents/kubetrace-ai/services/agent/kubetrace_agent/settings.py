"""Runtime settings, read from the environment. Credentials never leave the backend process."""
from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    # Inference. The model id is configuration, never guessed.
    nebius_api_key: str = Field(default="", repr=False)
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1"
    nebius_model: str = ""
    # Generation settings sent with every request. Only send what the model accepts.
    model_temperature: float | None = 0.2
    model_max_tokens: int = 2048
    model_reasoning_effort: str | None = None
    # "live" calls the endpoint; "fixture" uses the scripted test double, labelled as such.
    model_mode: str = "live"

    # Civo, used server-side only to list clusters and fetch a kubeconfig.
    civo_api_key: str = Field(default="", repr=False)
    civo_region: str = "LON1"
    civo_cluster_id: str = ""
    civo_api_url: str = "https://api.civo.com/v2"

    # Kubernetes.
    kubeconfig: str = ""
    kube_context: str = ""
    demo_namespace: str = "kubetrace-demo"
    partner_namespace: str = "kubetrace-partner"
    # "kind" or "civo": decides how images reach the cluster and how runs are labelled.
    cluster_kind: str = "kind"
    kind_cluster_name: str = "kubetrace"

    # Images. Tags are always unique per build; results never use "latest".
    image_repository: str = "kubetrace/storefront"
    registry: str = ""  # e.g. ttl.sh/kubetrace-abc123; required for Civo
    docker_bin: str = "docker"
    runner_image: str = "kubetrace-runner:1"
    # "docker" runs tests in a disposable container; "subprocess" is a less isolated fallback.
    test_runner: str = "docker"

    # Agent limits.
    max_agent_steps: int = 40
    max_run_seconds: int = 900
    max_run_tokens: int = 600_000
    max_write_attempts: int = 8
    max_tool_output_chars: int = 4000
    max_model_retries: int = 3
    verification_retries: int = 1

    # Policy: "review" waits for UI approval of each mutation; "auto" executes allowed changes.
    policy_mode: str = "auto"

    data_dir: Path = ROOT / "artifacts"
    database_path: Path = ROOT / "artifacts" / "kubetrace.db"
    pricing_file: Path = ROOT / "config" / "pricing.json"

    def secret_values(self) -> list[str]:
        values = [self.nebius_api_key, self.civo_api_key]
        values += [v for k, v in os.environ.items() if any(s in k.upper() for s in ("KEY", "TOKEN", "SECRET", "PASSWORD"))]
        return [v for v in values if v and len(v) >= 8]


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
        _settings.data_dir.mkdir(parents=True, exist_ok=True)
    return _settings


def reset_settings(**overrides) -> Settings:
    global _settings
    _settings = Settings(**overrides)
    _settings.data_dir.mkdir(parents=True, exist_ok=True)
    return _settings
