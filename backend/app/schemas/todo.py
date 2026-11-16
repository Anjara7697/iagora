from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.agent_mode import AgentMode
from app.schemas.conversation import ConversationProspect

TodoKind = Literal[
    "validation",
    "first_contact",
    "escalation",
    "kb_gap",
    "incident",
    "application",
    "enrollment",
    "opt_out_check",
]
Priority = Literal["critical", "high", "medium", "low"]


class TodoDraft(BaseModel):
    message_id: str
    content: str
    sources: list[str] = []
    confidence: float | None = None
    created_at: datetime
    subject: str | None = Field(None, description="Objet de l'email qui partira")
    footer: str | None = Field(
        None, description="Pied de message ajouté automatiquement (non modifiable)"
    )


class TodoRecommendation(BaseModel):
    action: str = Field(description="Prochaine action recommandée")
    reason: str | None = None
    risk: Literal["low", "medium", "high"] = "medium"
    confidence: float | None = None
    sources: list[str] = []


class TodoItem(BaseModel):
    id: str
    kind: TodoKind
    priority: Priority
    conversation_id: str
    prospect: ConversationProspect | None
    channel: str
    title: str
    detail: str | None = None
    created_at: datetime | None
    draft: TodoDraft | None = None
    handoff: dict[str, Any] | None = None
    recommendation: TodoRecommendation | None = None


class TreatedItem(BaseModel):
    id: str
    conversation_id: str
    prospect: ConversationProspect | None
    channel: str
    decision: Literal["approved", "rejected"]
    decided_at: datetime | None
    decided_by: int | None = None
    edited: bool = False
    content: str
    reason: str | None = Field(None, description="Motif du refus")
    execution: Literal["approved", "sending", "sent", "failed", "blocked", "rejected"]
    execution_detail: str | None = Field(None, description="Cause d'un échec ou d'un blocage")


class TreatedPage(BaseModel):
    items: list[TreatedItem]
    total: int
    hours: int
    truncated: bool = Field(
        False,
        description="Vrai si la liste est incomplète (seules les conversations récentes sont lues)",
    )


class TodoPage(BaseModel):
    items: list[TodoItem]
    total: int
    limit: int
    offset: int
    counts: dict[str, int] = Field(description="Nombre d'éléments par type (avant filtre)")
    truncated: bool = Field(
        False,
        description="Vrai si la liste est incomplète (seules les conversations récentes sont lues)",
    )


class DraftApprove(BaseModel):
    content: str | None = Field(
        None, max_length=20_000, description="Texte modifié, le cas échéant"
    )


class DraftReject(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class AgentModeRead(BaseModel):
    mode: AgentMode
    updated_by: int | None = None
    updated_at: datetime | None = None


class AgentModeUpdate(BaseModel):
    mode: AgentMode


class OptOutReviewDecision(BaseModel):
    decision: Literal["confirm", "restore"]
    reason: str | None = Field(
        None, max_length=500, description="Obligatoire pour rétablir le consentement (D-20)"
    )


class DraftRef(BaseModel):
    conversation_id: str = Field(max_length=64)
    message_id: str = Field(max_length=64)


class FirstContactApproval(BaseModel):
    """Premiers contacts relus et validés ensemble (au plus 100, ceux affichés dans la file)."""

    drafts: list[DraftRef] = Field(min_length=1, max_length=100)


class BatchResult(BaseModel):
    approved: int
    skipped: int = Field(description="Brouillons déjà traités, hors périmètre ou non éligibles")
