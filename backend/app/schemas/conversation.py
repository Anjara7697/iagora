from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.models.enums import ConversationStatus, SenderType


def _aware(value: datetime | None) -> datetime | None:
    """MongoDB stocke des dates UTC ; on garantit un fuseau à la sortie."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


class MessageCreate(BaseModel):
    role: SenderType
    content: str = Field(min_length=1, max_length=20_000)
    external_message_id: str | None = Field(
        None, max_length=255, description="Identifiant du message côté plateforme (idempotence)"
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Données libres : sources RAG, intention, charge brute..."
    )


class MessageRead(BaseModel):
    id: str
    role: SenderType
    content: str
    external_message_id: str | None = None
    created_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)

    _tz = field_validator("created_at")(_aware)


class ConversationCreate(BaseModel):
    prospect_id: int
    channel: str = Field(description="Nom du canal (ex. email)")
    message: MessageCreate | None = Field(None, description="Premier message éventuel")


class ConversationUpdate(BaseModel):
    status: ConversationStatus | None = None
    summary: str | None = Field(None, max_length=10_000)


class ConversationRead(BaseModel):
    id: str
    prospect_id: int
    channel: str
    status: ConversationStatus
    summary: str | None = None
    started_at: datetime
    last_message_at: datetime | None = None
    closed_at: datetime | None = None
    messages: list[MessageRead] = []
    handoff: dict[str, Any] | None = Field(
        None,
        description="Fiche de transfert remise au conseiller (F-21), le cas échéant",
    )

    _tz = field_validator("started_at", "last_message_at", "closed_at")(_aware)


class ConversationResult(BaseModel):
    conversation: ConversationRead
    created: bool = Field(description="False si la conversation ouverte existait déjà")


class MessageResult(BaseModel):
    conversation_id: str
    message: MessageRead
    created: bool = Field(
        description="False si ce message (même identifiant externe) existait déjà"
    )
