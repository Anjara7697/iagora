from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class ServiceTokenCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100, description="Ex. « Formulaire du site »")
    channel: str = Field("web_form", max_length=50)
    campaign_id: int | None = None
    source_id: int | None = None
    target_code: str | None = Field(None, max_length=50)


class ServiceTokenRead(BaseModel):
    id: str
    name: str
    hint: str
    channel: str
    campaign_id: int | None = None
    source_id: int | None = None
    target_code: str | None = None
    created_at: datetime
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None


class ServiceTokenCreated(ServiceTokenRead):
    token: str = Field(description="Affiché une seule fois")


class LeadIn(BaseModel):
    """Prospect envoyé par un formulaire ou un outil externe (jeton de service)."""

    first_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    email: EmailStr | None = None
    phone: str | None = Field(None, max_length=50)
    message: str | None = Field(None, max_length=5000)
    target_code: str | None = Field(None, max_length=50, description="Si le jeton n'en fixe pas")
    consent: bool = Field(False, description="Case de consentement cochée par le prospect")
    external_id: str | None = Field(None, max_length=255, description="Identifiant côté outil")
    profile: dict[str, Any] = Field(default_factory=dict)


class LeadAccepted(BaseModel):
    prospect_id: int
    created: bool


class ImportRowError(BaseModel):
    row: int
    error: str


class ImportReport(BaseModel):
    dry_run: bool
    total: int
    created: int
    existing: int
    invalid: list[ImportRowError] = Field(default_factory=list)
    columns: dict[str, str] = Field(description="Colonne du fichier -> champ IAGORA")
