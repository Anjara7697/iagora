from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import CampaignStatus


class SourceInput(BaseModel):
    name: str = Field(max_length=200)
    type: str = Field(max_length=50, examples=["ads", "form", "landing_page", "webinar", "import"])
    platform: str = Field(max_length=50, examples=["linkedin", "meta", "web"])
    external_id: str | None = Field(None, max_length=255)


class _CampaignDates(BaseModel):
    start_date: datetime | None = None
    end_date: datetime | None = None

    @model_validator(mode="after")
    def _check_dates(self) -> "_CampaignDates":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date doit être postérieure à start_date")
        return self


class CampaignCreate(_CampaignDates):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    status: CampaignStatus = CampaignStatus.DRAFT
    target_codes: list[str] = Field(default_factory=list)
    sources: list[SourceInput] = Field(default_factory=list)


class CampaignUpdate(_CampaignDates):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    status: CampaignStatus | None = None
    target_codes: list[str] | None = Field(None, description="Remplace l'ensemble des cibles")


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    platform: str
    external_id: str | None


class TargetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str


class CampaignRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    responsible_advisor_id: int | None = None
    responsible_advisor_name: str | None = None
    responsible_advisor_active: bool | None = None
    name: str
    description: str | None
    status: CampaignStatus
    start_date: datetime | None
    end_date: datetime | None
    created_at: datetime
    updated_at: datetime
    targets: list[TargetRead] = []
    sources: list[SourceRead] = []


class CampaignOwnershipUpdate(BaseModel):
    advisor_id: int | None = Field(ge=1)
    existing_prospects: Literal["transfer_inherited", "keep"]


class SourceCount(BaseModel):
    source_id: int
    name: str
    platform: str
    prospects: int


class CampaignStats(BaseModel):
    """Tableau de bord d'une campagne : entonnoir, niveaux d'intérêt et sources (F-01, F-13)."""

    prospects: int
    average_score: float
    by_stage: dict[str, int]
    by_level: dict[str, int] = Field(description="Niveau d'intérêt ; « none » : non évalué")
    by_source: list[SourceCount]
    meetings: int = Field(description="Rendez-vous planifiés ou tenus")
    converted: int


class CampaignOverview(BaseModel):
    """Chiffres clés d'une campagne pour la liste."""

    campaign_id: int
    prospects: int
    hot: int = Field(description="Prospects chauds ou très chauds")
    meetings: int
    qualified: int = Field(
        0, description="Prospects qualifiés ou plus avancés (rendez-vous, candidature, inscrits)"
    )
    converted: int


class FirstContactsRead(BaseModel):
    """Premiers contacts d'une campagne : qui les recevrait, et pourquoi les autres non (D-29)."""

    campaign_active: bool
    eligible: int = Field(description="Personnes à qui l'agent peut écrire le premier message")
    queued: int = Field(0, description="Premiers contacts mis en préparation par cette demande")
    without_consent: int = Field(0, description="Consentement non recueilli : aucun message")
    without_email: int = 0
    already_contacted: int = Field(0, description="Déjà en échange ou plus à l'étape Nouveau")
    in_progress: int = Field(0, description="Premier contact déjà en préparation")
    opted_out: int = 0
