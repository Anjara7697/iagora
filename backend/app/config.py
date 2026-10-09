"""Configuration de l'application, chargee depuis les variables d'environnement (S-04)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-insecure-secret-change-me-before-any-real-use"  # noqa: S105


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Agent Intelligent Commercial 2.0"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    postgres_dsn: str = "postgresql+asyncpg://iagora:iagora@localhost:5432/iagora"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "iagora"
    redis_url: str = "redis://localhost:6379/0"

    # Authentification (S-06). La valeur par défaut n'est acceptée qu'en développement.
    jwt_secret_key: SecretStr = SecretStr(DEV_JWT_SECRET)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(60, ge=1)

    # Cles des fournisseurs de LLM : optionnelles tant que l'agent n'est pas branche.
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None

    @model_validator(mode="after")
    def _require_real_secret_in_production(self) -> "Settings":
        secret = self.jwt_secret_key.get_secret_value()
        if not secret:
            raise ValueError("JWT_SECRET_KEY ne peut pas être vide")
        if self.environment == "production" and (secret == DEV_JWT_SECRET or len(secret) < 32):
            raise ValueError(
                "JWT_SECRET_KEY doit être défini (32 caractères minimum) en production"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
