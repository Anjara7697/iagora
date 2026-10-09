"""Configuration de l'application, chargee depuis les variables d'environnement (S-04)."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Cles des fournisseurs de LLM : optionnelles tant que l'agent n'est pas branche.
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
