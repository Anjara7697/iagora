from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import ConsentEventType
from app.models.mixins import CreatedAtMixin, str_enum


class Channel(Base):
    """Canal de communication : email, facebook, instagram, linkedin, ..."""

    __tablename__ = "channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    type: Mapped[str] = mapped_column(String(50))


class ProspectChannel(CreatedAtMixin, Base):
    """Canal disponible pour un prospect, avec son identifiant (adresse, id de plateforme)."""

    __tablename__ = "prospect_channels"
    __table_args__ = (
        # Un identifiant (ex. une adresse email) n'appartient qu'à un seul prospect (F-05).
        UniqueConstraint("channel_id", "channel_identifier"),
        UniqueConstraint("prospect_id", "channel_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(ForeignKey("prospects.id", ondelete="CASCADE"))
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"))
    channel_identifier: Mapped[str] = mapped_column(String(255))
    is_preferred: Mapped[bool] = mapped_column(server_default=false())
    is_verified: Mapped[bool] = mapped_column(server_default=false())


class ConsentEvent(CreatedAtMixin, Base):
    """Historique du consentement / opt-out (S-02, S-03, S-07)."""

    __tablename__ = "consent_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), index=True
    )
    channel_id: Mapped[int | None] = mapped_column(ForeignKey("channels.id"))
    event_type: Mapped[ConsentEventType] = mapped_column(
        str_enum(ConsentEventType, "consent_event_type")
    )
    source: Mapped[str] = mapped_column(String(100))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
