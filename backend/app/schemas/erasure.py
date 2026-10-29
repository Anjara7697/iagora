from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ErasureRequest(BaseModel):
    reason: Literal["request", "other"] = Field(
        description="`request` : la personne a demandé l'effacement ; `other` : autre motif"
    )
    confirm: str = Field(
        min_length=1,
        max_length=255,
        description="Adresse email du prospect (ou son numéro de fiche s'il n'en a pas)",
    )


class ExternalEvent(BaseModel):
    """Rendez-vous créé hors d'IAGORA : à supprimer à la main dans l'agenda ou Zoom."""

    start_at: datetime
    advisor: str | None = None
    calendar_event_id: str | None = None
    zoom_meeting_id: str | None = None
    meeting_url: str | None = None


class ErasureReport(BaseModel):
    prospect_id: int
    conversations: int
    interactions: int
    appointments: int
    suppressed: bool = Field(description="Une empreinte est conservée pour ne plus le recontacter")
    external_events: list[ExternalEvent]
