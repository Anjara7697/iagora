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

    # Modèle de langage (workflow agentique). Changer de fournisseur = changer ces variables.
    llm_provider: str = "gemini"
    llm_model: str = "gemini-2.5-flash"
    llm_temperature: float = Field(0.3, ge=0.0, le=2.0)
    llm_timeout_seconds: float = Field(30.0, gt=0)
    llm_max_retries: int = Field(3, ge=0, le=8)

    # Base de connaissances (RAG). Changer de modèle d'embedding impose `kb-reindex` : des vecteurs
    # de modèles différents ne sont pas comparables. La dimension (768) est fixée par le schéma.
    embedding_provider: str = "gemini"
    embedding_model: str = "gemini-embedding-001"
    rag_top_k: int = Field(4, ge=1, le=10)
    # Similarité cosinus minimale pour qu'un extrait soit retenu : en dessous, la base « ne sait
    # pas » et l'agent transfère au conseiller. À calibrer avec `kb-eval` après tout changement.
    rag_min_score: float = Field(0.6, ge=0.0, le=1.0)

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
