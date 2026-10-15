from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class EmailStatus(BaseModel):
    configured: bool = Field(description="Identifiants renseignés dans l'environnement")
    enabled: bool = Field(description="Boucle de fond activée (EMAIL_ENABLED)")
    send_enabled: bool = Field(description="Envoi réel activé (EMAIL_SEND_ENABLED)")
    sender: str | None = None
    imap_host: str
    smtp_host: str
    sandbox_recipients: list[str] = Field(default_factory=list)
    last_run_at: datetime | None = None
    last_error: str | None = None
    last_report: dict[str, Any] | None = None
    outbox: dict[str, int] = Field(
        default_factory=dict, description="Messages email par état d'envoi"
    )


class EmailCheck(BaseModel):
    imap: str
    smtp: str


class EmailSyncResult(BaseModel):
    report: dict[str, Any]
