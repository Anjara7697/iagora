import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.enums import ConsentStatus, ConversionStage, InterestLevel

_PHONE_SEPARATORS = re.compile(r"[\s.\-()]")


def normalize_phone(value: str | None) -> str | None:
    """Normalisation minimale pour la déduplication (F-05) : sans séparateurs, '00' -> '+'."""
    if value is None:
        return None
    phone = _PHONE_SEPARATORS.sub("", value)
    if phone.startswith("00"):
        phone = "+" + phone[2:]
    return phone or None


class _Identity(BaseModel):
    first_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    email: EmailStr | None = None
    phone: str | None = Field(None, max_length=50)
    linkedin_id: str | None = Field(None, max_length=255)
    facebook_id: str | None = Field(None, max_length=255)
    instagram_id: str | None = Field(None, max_length=255)

    @field_validator("email")
    @classmethod
    def _lower_email(cls, v: str | None) -> str | None:
        return v.strip().lower() if v else None

    @field_validator("phone")
    @classmethod
    def _clean_phone(cls, v: str | None) -> str | None:
        return normalize_phone(v)

    @field_validator("first_name", "last_name", "linkedin_id", "facebook_id", "instagram_id")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        return v.strip() or None if v else None


class ProspectIngest(_Identity):
    """Prospect reçu d'un système externe (F-04)."""

    channel: str | None = Field(None, description="Nom du canal d'arrivée (ex. email, facebook)")
    campaign_id: int | None = None
    source_id: int | None = None
    target_code: str | None = None
    message: str | None = Field(None, description="Message éventuel du prospect")
    external_id: str | None = Field(None, max_length=255, description="Identifiant externe")
    consent_granted: bool | None = None
    consent_source: str | None = Field(None, max_length=100)
    profile: dict[str, Any] = Field(default_factory=dict)

    def has_identifier(self) -> bool:
        return any([self.email, self.phone, self.linkedin_id, self.facebook_id, self.instagram_id])


class ProspectUpdate(_Identity):
    target_code: str | None = None
    profile: dict[str, Any] | None = None


class CampaignMembershipRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_source_id: int
    interest_status: InterestLevel | None
    conversion_stage: ConversionStage
    interest_score: int
    fit_score: int
    total_score: int
    assigned_advisor_id: int | None
    first_seen_at: datetime
    last_seen_at: datetime


class ProspectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    first_name: str | None
    last_name: str | None
    email: str | None
    phone: str | None
    linkedin_id: str | None
    facebook_id: str | None
    instagram_id: str | None
    target_id: int | None
    origin_channel_id: int | None
    current_channel_id: int | None
    profile: dict[str, Any]
    consent_status: ConsentStatus
    consent_source: str | None
    consent_given_at: datetime | None
    opted_out_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ProspectDetail(ProspectRead):
    campaigns: list[CampaignMembershipRead] = []


class ProspectIngestResult(BaseModel):
    prospect: ProspectDetail
    created: bool = Field(description="False si un prospect existant a été reconnu (déduplication)")
    interaction_id: int


class ConsentRequest(BaseModel):
    source: str = Field(max_length=100)
    channel: str | None = None


class OptOutRequest(BaseModel):
    source: str = Field("prospect_request", max_length=100)
    channel: str | None = None
