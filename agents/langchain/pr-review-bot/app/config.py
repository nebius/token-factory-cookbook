from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    github_webhook_secret: SecretStr
    nebius_api_key: SecretStr
    github_app_id: str | None = None
    github_app_private_key: SecretStr | None = None
    github_token: SecretStr | None = None
    nebius_model: str = "moonshotai/Kimi-K2.5"
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1/"
    review_drafts: bool = False
    max_files: int = Field(default=40, ge=1, le=100)
    max_patch_chars: int = Field(default=120_000, ge=5_000, le=500_000)
    max_findings: int = Field(default=8, ge=1, le=20)
    log_level: str = "INFO"

    @model_validator(mode="after")
    def validate_github_auth(self) -> "Settings":
        started_app_auth = bool(self.github_app_id) or self.github_app_private_key is not None
        completed_app_auth = bool(self.github_app_id) and self.github_app_private_key is not None
        if started_app_auth and not completed_app_auth:
            raise ValueError("Set both GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY, or neither.")
        if not completed_app_auth and self.github_token is None:
            raise ValueError("Set GitHub App credentials or GITHUB_TOKEN.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
