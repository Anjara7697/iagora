from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.conversation import ConversationProspect
from app.services.agent_settings import AgentMode

TodoKind = Literal["validation", "escalation", "kb_gap", "incident"]
Priority = Literal["critical", "high", "medium", "low"]


class TodoDraft(BaseModel):
    message_id: str
    content: str
    sources: list[str] = []
    confidence: float | None = None
    created_at: datetime


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


class TodoPage(BaseModel):
    items: list[TodoItem]
    total: int
    limit: int
    offset: int
    counts: dict[str, int] = Field(description="Nombre d'éléments par type (avant filtre)")


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
