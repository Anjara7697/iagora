"""Journal en direct de l'agent (voir `services/agent_activity`)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.conversation import ConversationProspect

ActivityState = Literal["queued", "waiting", "running", "retrying", "stalled", "done", "failed"]
WaitingReason = Literal["grouping", "manual_mode", "unassigned", "campaign_paused"]


class LiveActivityStep(BaseModel):
    node: str
    label: str
    status: Literal["running", "done"]
    detail: str | None = None
    started_at: datetime
    finished_at: datetime | None = None


class LiveActivity(BaseModel):
    """État affiché dans la console.

    `state` : queued (va démarrer), waiting (attend : `waiting_reason`), running, retrying
    (erreur, nouvel essai à `next_attempt_at`), stalled (plus de nouvelles depuis 3 min),
    done (terminé il y a moins de 10 min), failed (abandonné après plusieurs erreurs)."""

    conversation_id: str
    prospect_id: int
    state: ActivityState
    waiting_reason: WaitingReason | None = None
    next_attempt_at: datetime | None = None
    started_at: datetime | None = None
    updated_at: datetime | None = None
    finished_at: datetime | None = None
    outcome: str | None = None
    steps: list[LiveActivityStep] = []


class LiveActivityItem(LiveActivity):
    """Ligne de « En cours maintenant » : l'activité et la carte du prospect."""

    prospect: ConversationProspect | None = None
