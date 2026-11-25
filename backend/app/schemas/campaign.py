from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.agent_mode import AgentMode
from app.models.enums import CampaignStatus


class SourceInput(BaseModel):
    name: str = Field(max_length=200)
    type: str = Field(max_length=50, examples=["ads", "form", "landing_page", "webinar", "import"])
    platform: str = Field(max_length=50, examples=["linkedin", "meta", "web"])
    external_id: str | None = Field(None, max_length=255)


class CampaignFileRead(BaseModel):
    """Document de campagne que l'agent peut joindre à un email (D-42), sans son contenu."""

    id: str
    label: str
    usage: str = ""
    filename: str
    content_type: str
    size: int
    created_at: datetime


class CampaignResource(BaseModel):
    """Lien validé que l'agent peut partager (D-39) : jamais un lien inventé par le modèle."""

    label: str = Field(min_length=1, max_length=120, examples=["Inscription au Master eBIHAR"])
    url: str = Field(max_length=500, examples=["https://www.datumacademy.com/fr/masters/eBIHAR"])
    usage: str = Field("", max_length=300, description="Quand l'agent doit le proposer")

    @field_validator("label", "usage")
    @classmethod
    def _one_line(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("url")
    @classmethod
    def _https(cls, value: str) -> str:
        value = value.strip()
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.netloc or any(c.isspace() for c in value):
            raise ValueError("Adresse attendue en https://…")
        return value


class CampaignBrief(BaseModel):
    """Fiche de campagne (D-52) : ce qui distingue cette campagne, donné à l'agent à chaque message.

    Offre, dates et conditions sont des faits validés que l'agent peut citer ; « à éviter » est une
    consigne, jamais une source. Après la date de fin de la campagne, la fiche n'est plus donnée.
    """

    offer: str = Field(
        "",
        max_length=800,
        description="Offre et message clé",
        examples=["Rentrée de janvier en alternance : frais de dossier offerts"],
    )
    key_dates: str = Field(
        "",
        max_length=600,
        description="Dates importantes (rentrée, date limite, événement)",
        examples=["Date limite de candidature : 15 décembre. Rentrée : 12 janvier."],
    )
    conditions: str = Field(
        "",
        max_length=800,
        description="Conditions particulières (tarif, places, public)",
        examples=["30 places. Offre réservée aux candidats inscrits avant le 15 décembre."],
    )
    avoid: str = Field(
        "",
        max_length=600,
        description="Ce que l'agent ne doit pas dire ou promettre dans cette campagne",
        examples=["Ne pas parler de la rentrée de septembre."],
    )

    @field_validator("offer", "key_dates", "conditions", "avoid")
    @classmethod
    def _clean(cls, value: str) -> str:
        lines = (" ".join(line.split()) for line in value.splitlines())
        return "\n".join(line for line in lines if line)


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
    email_subject: str | None = Field(
        None, max_length=200, description="Objet imposé du premier email ; vide : écrit par l'agent"
    )
    resources: list[CampaignResource] | None = Field(
        None, max_length=20, description="Remplace l'ensemble des ressources"
    )
    brief: CampaignBrief | None = Field(None, description="Remplace la fiche de campagne")


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
    email_subject: str | None = None
    resources: list[CampaignResource] = []
    brief: CampaignBrief = Field(default_factory=CampaignBrief)


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


class AgentModesByKind(BaseModel):
    """Mode de l'agent par type de message ; `null` : suivre le réglage général."""

    first_contact: AgentMode | None = None
    reply: AgentMode | None = None
    follow_up: AgentMode | None = None


class CampaignAgentModesRead(BaseModel):
    """Autonomie de l'agent sur une campagne (D-51) : réglages propres à la campagne, et mode
    réellement appliqué à chaque type de message (arrêt d'urgence et D-16 compris)."""

    campaign_id: int
    overrides: AgentModesByKind
    effective: dict[str, AgentMode]
    global_mode: AgentMode
    auto_allowed: bool
    updated_by: int | None = None
    updated_at: datetime | None = None
