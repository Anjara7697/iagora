from datetime import datetime

from pydantic import BaseModel, Field


class PlannedFollowUp(BaseModel):
    """Relance programmée par l'agent, pas encore partie."""

    id: int
    prospect_id: int
    prospect_name: str
    channel: str | None = Field(None, description="Canal prévu ; None : celui de la conversation")
    scheduled_at: datetime = Field(description="Heure demandée par l'agent ou le conseiller")
    expected_at: datetime = Field(
        description="Heure de départ prévue : `scheduled_at`, repoussée à l'ouverture de la "
        "fenêtre d'envoi si besoin. Indicative : un arrêt de l'agent la retarde encore."
    )
    reason: str | None = None


class FollowUpReschedule(BaseModel):
    scheduled_at: datetime = Field(
        description="Nouvelle heure, avec fuseau, dans le futur et à 90 jours au plus"
    )
