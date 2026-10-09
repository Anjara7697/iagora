from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import ConversationStatus, Direction, SenderType
from app.models.mixins import CreatedAtMixin, str_enum


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), index=True
    )
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"))
    status: Mapped[ConversationStatus] = mapped_column(
        str_enum(ConversationStatus, "conversation_status"),
        default=ConversationStatus.OPEN,
        server_default=ConversationStatus.OPEN.value,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(CreatedAtMixin, Base):
    __tablename__ = "messages"
    # Idempotence à la réception (webhooks rejoués, relève IMAP répétée) : NF-05, §10.3.
    __table_args__ = (UniqueConstraint("conversation_id", "external_message_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    sender_type: Mapped[SenderType] = mapped_column(str_enum(SenderType, "sender_type"))
    content: Mapped[str] = mapped_column(Text)
    external_message_id: Mapped[str | None] = mapped_column(String(255))


class Interaction(CreatedAtMixin, Base):
    """Historique des échanges et événements du parcours (F-06, OB-05)."""

    __tablename__ = "interactions"
    __table_args__ = (
        UniqueConstraint("channel_id", "external_id"),
        Index("ix_interactions_prospect_created", "prospect_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(ForeignKey("prospects.id", ondelete="CASCADE"))
    channel_id: Mapped[int | None] = mapped_column(ForeignKey("channels.id"))
    type: Mapped[str] = mapped_column(String(50))
    direction: Mapped[Direction] = mapped_column(str_enum(Direction, "direction"))
    content: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str | None] = mapped_column(String(255))
    intent: Mapped[str | None] = mapped_column(String(100))
    sentiment: Mapped[str | None] = mapped_column(String(50))
