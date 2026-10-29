from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, model_validator

from app.config import DEFAULT_AI_NOTICE, DEFAULT_BRAND_COLOR, DEFAULT_BRAND_NAME


class RuntimeSettingsBase(BaseModel):
    # Intelligence artificielle
    llm_provider: Literal["gemini", "openai"] = "gemini"
    llm_model: str = Field(min_length=2, max_length=100)
    llm_fallback_model: str = Field("", max_length=100)
    llm_temperature: float = Field(0.3, ge=0.0, le=2.0)
    # Agent et relances
    agent_auto_reply: bool = True
    follow_up_window_start_hour: int = Field(8, ge=0, le=23)
    follow_up_window_end_hour: int = Field(19, ge=1, le=24)
    follow_up_weekdays_only: bool = True
    follow_up_max_per_silence: int = Field(3, ge=1, le=10)
    # Emails
    email_footer: str = Field("", max_length=1000)
    email_ai_notice: str = Field(DEFAULT_AI_NOTICE, min_length=10, max_length=500)
    email_brand_name: str = Field(DEFAULT_BRAND_NAME, min_length=1, max_length=80)
    email_brand_color: str = Field(DEFAULT_BRAND_COLOR, pattern=r"^#[0-9a-fA-F]{6}$")
    email_logo_url: str = Field("", max_length=500, pattern=r"^(https://\S+)?$")
    email_create_unknown_senders: bool = True
    email_poll_seconds: int = Field(60, ge=10, le=3600)
    # Disponibilités des rendez-vous
    calendar_timezone: str = Field("Europe/Paris", max_length=60)
    calendar_work_days: str = Field("1,2,3,4,5", pattern=r"^[1-7](,[1-7])*$")
    calendar_work_start_hour: int = Field(9, ge=0, le=23)
    calendar_work_end_hour: int = Field(18, ge=1, le=24)
    calendar_slot_minutes: int = Field(30, ge=15, le=240)
    calendar_min_notice_hours: int = Field(4, ge=0, le=240)
    calendar_horizon_days: int = Field(14, ge=1, le=60)
    calendar_buffer_minutes: int = Field(0, ge=0, le=120)

    @model_validator(mode="after")
    def _coherent(self) -> "RuntimeSettingsBase":
        if self.follow_up_window_end_hour <= self.follow_up_window_start_hour:
            raise ValueError("La fin de la fenêtre des relances doit suivre son début")
        if self.calendar_work_end_hour <= self.calendar_work_start_hour:
            raise ValueError("La fin de la journée de travail doit suivre son début")
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(self.calendar_timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Fuseau horaire inconnu : {self.calendar_timezone}") from exc
        return self


class RuntimeSettingsWrite(RuntimeSettingsBase):
    gemini_api_key: SecretStr | None = Field(None, description="Vide : garder la clé actuelle")
    openai_api_key: SecretStr | None = Field(None, description="Vide : garder la clé actuelle")


class RuntimeSettingsRead(RuntimeSettingsBase):
    source: Literal["console", "env"]
    gemini_api_key_set: bool
    openai_api_key_set: bool
    embedding_model: str = Field(description="Lecture seule : en changer impose kb-reindex")
    updated_at: datetime | None = None


class LlmTestResult(BaseModel):
    ok: bool
    model: str
    detail: str


class EmailPreview(BaseModel):
    html: str
    text: str
