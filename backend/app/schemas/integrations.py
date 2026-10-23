from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, SecretStr


class EmailStatus(BaseModel):
    configured: bool = Field(description="Identifiants renseignés (console ou .env)")
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


class EmailConfigBase(BaseModel):
    address: EmailStr
    username: str | None = Field(None, max_length=255, description="Par défaut : l'adresse")
    imap_host: str = Field(min_length=3, max_length=255)
    imap_port: int = Field(993, ge=1, le=65535)
    imap_folder: str = Field("INBOX", min_length=1, max_length=255)
    smtp_host: str = Field(min_length=3, max_length=255)
    smtp_port: int = Field(587, ge=1, le=65535)
    smtp_security: Literal["starttls", "ssl"] = "starttls"
    from_name: str = Field("DATUM Academy", max_length=120)
    enabled: bool = Field(False, description="Relève automatique de la boîte")
    send_enabled: bool = Field(False, description="Envoi réel des messages validés")
    sandbox_recipients: list[EmailStr] = Field(default_factory=list, max_length=50)


class EmailConfigWrite(EmailConfigBase):
    password: SecretStr | None = Field(None, description="Vide : garder le mot de passe enregistré")


class EmailConfigRead(EmailConfigBase):
    address: str  # vide tant qu'aucune boîte n'est renseignée
    source: Literal["console", "env"]
    password_set: bool
    updated_at: datetime | None = None
    updated_by: int | None = None


class EmailAutodetectIn(BaseModel):
    address: EmailStr


class EmailAutodetect(BaseModel):
    provider: str | None
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    smtp_security: Literal["starttls", "ssl"]
    source: Literal["preset", "mx", "ispdb", "guess"]
    note: str | None = None


class EmailFolder(BaseModel):
    name: str = Field(description="Nom exact à enregistrer")
    label: str = Field(description="Nom lisible (accents décodés)")


class EmailTestResult(BaseModel):
    imap: str
    smtp: str
    folders: list[EmailFolder] = Field(default_factory=list)
