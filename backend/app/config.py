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
    # Modèle de secours (même fournisseur, même clé) si le principal est saturé : vide = aucun.
    llm_fallback_model: str = ""
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

    # Déclenchement automatique de l'agent et relances (F-06, F-16).
    # `agent_auto_reply` : dès qu'un message du prospect est enregistré, l'agent prépare sa réponse
    # (brouillon en mode assisté). `follow_up_*` : exécuteur des relances programmées.
    agent_auto_reply: bool = True
    follow_up_worker_enabled: bool = True
    follow_up_interval_seconds: int = Field(300, ge=5)
    follow_up_max_per_silence: int = Field(3, ge=1, le=10)
    # Fenêtre d'envoi des relances : jours ouvrés, heure de Paris (début inclus, fin exclue).
    follow_up_window_start_hour: int = Field(8, ge=0, le=23)
    follow_up_window_end_hour: int = Field(19, ge=1, le=24)
    follow_up_weekdays_only: bool = True

    # Connecteur email (IMAP pour recevoir, SMTP pour envoyer). Les identifiants ne vont que dans
    # le .env local : jamais dans Git, jamais dans les journaux (S-04). Valeurs IONOS à vérifier.
    email_enabled: bool = False
    email_imap_host: str = "imap.ionos.fr"
    email_imap_port: int = 993
    email_imap_folder: str = "INBOX"
    email_smtp_host: str = "smtp.ionos.fr"
    email_smtp_port: int = 587
    email_smtp_security: Literal["starttls", "ssl"] = "starttls"
    email_username: str = ""
    email_password: SecretStr | None = None
    email_from_address: str = ""  # par défaut : l'identifiant de connexion
    email_from_name: str = "DATUM Academy"
    email_poll_seconds: int = Field(60, ge=10)
    # Envoi réel des messages validés : désactivé par défaut (réception seule).
    email_send_enabled: bool = False
    # Bac à sable : si renseigné (adresses séparées par des virgules), l'agent n'écrit QU'À ces
    # adresses ; tout autre destinataire est bloqué. À utiliser pendant les essais.
    email_sandbox_recipients: str = ""
    # Un expéditeur inconnu devient un prospect (sans campagne).
    email_create_unknown_senders: bool = True
    email_footer: str = (
        "Pour ne plus recevoir de messages de notre part, répondez simplement STOP à cet email."
    )

    # Rendez-vous : `none` (l'agent transfère les demandes au conseiller), `google` (Google Calendar
    # du conseiller + visioconférence Zoom) ou `demo` (créneaux fictifs, hors production).
    calendar_provider: Literal["none", "google", "demo"] = "none"
    calendar_timezone: str = "Europe/Paris"
    calendar_slot_minutes: int = Field(30, ge=15, le=240)
    calendar_work_days: str = "1,2,3,4,5"  # jours ISO : 1 = lundi … 7 = dimanche
    calendar_work_start_hour: int = Field(9, ge=0, le=23)
    calendar_work_end_hour: int = Field(18, ge=1, le=24)
    calendar_min_notice_hours: int = Field(4, ge=0, le=240)
    calendar_horizon_days: int = Field(14, ge=1, le=60)
    calendar_buffer_minutes: int = Field(0, ge=0, le=120)
    # Google Calendar : compte de service (clé JSON, par fichier ou en ligne). Chaque conseiller
    # partage son agenda avec ce compte. L'identifiant d'agenda d'un conseiller est son email.
    google_service_account_file: str = ""
    google_service_account_json: SecretStr | None = None
    google_calendar_default_id: str = ""  # agenda commun si le prospect n'a pas de conseiller
    # Zoom : application « Server-to-Server OAuth ». Sans identifiants, le rendez-vous est
    # enregistré dans l'agenda sans lien de visioconférence.
    zoom_account_id: str = ""
    zoom_client_id: str = ""
    zoom_client_secret: SecretStr | None = None
    zoom_host_user: str = "me"  # hôte par défaut si le conseiller n'a pas de compte Zoom

    # Clé de chiffrement des identifiants saisis dans la console (connecteurs). Facultative : à
    # défaut, dérivée de JWT_SECRET_KEY (changer l'une ou l'autre oblige à les ressaisir).
    connectors_secret_key: SecretStr | None = None

    # Cles des fournisseurs de LLM : optionnelles tant que l'agent n'est pas branche.
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None

    @property
    def calendar_work_weekdays(self) -> set[int]:
        return {int(d) for d in self.calendar_work_days.split(",") if d.strip().isdigit()}

    @property
    def email_sandbox_list(self) -> list[str]:
        return [a.strip().lower() for a in self.email_sandbox_recipients.split(",") if a.strip()]

    @property
    def email_sender_address(self) -> str:
        return (self.email_from_address or self.email_username).strip().lower()

    @model_validator(mode="after")
    def _require_real_secret_in_production(self) -> "Settings":
        secret = self.jwt_secret_key.get_secret_value()
        if not secret:
            raise ValueError("JWT_SECRET_KEY ne peut pas être vide")
        if self.environment == "production" and (secret == DEV_JWT_SECRET or len(secret) < 32):
            raise ValueError(
                "JWT_SECRET_KEY doit être défini (32 caractères minimum) en production"
            )
        if self.environment == "production" and self.calendar_provider == "demo":
            raise ValueError("CALENDAR_PROVIDER=demo (créneaux fictifs) est interdit en production")
        if self.calendar_work_end_hour <= self.calendar_work_start_hour:
            raise ValueError("CALENDAR_WORK_END_HOUR doit être après CALENDAR_WORK_START_HOUR")
        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG doit être désactivé en production")
            for origin in self.cors_origins:
                if origin == "*" or "localhost" in origin or "127.0.0.1" in origin:
                    raise ValueError(f"CORS_ORIGINS invalide en production : {origin}")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
