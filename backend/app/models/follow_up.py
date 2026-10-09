from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import FollowUpStatus
from app.models.mixins import CreatedAtMixin, str_enum


class FollowUp(CreatedAtMixin, Base):
    """Relance programmée (F-16). Le service doit vérifier l'opt-out avant exécution."""

    __tablename__ = "follow_ups"
    __table_args__ = (Index("ix_follow_ups_status_scheduled", "status", "scheduled_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(ForeignKey("prospects.id", ondelete="CASCADE"))
    campaign_prospect_id: Mapped[int | None] = mapped_column(
        ForeignKey("campaign_prospects.id", ondelete="CASCADE")
    )
    channel_id: Mapped[int | None] = mapped_column(ForeignKey("channels.id"))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[FollowUpStatus] = mapped_column(
        str_enum(FollowUpStatus, "follow_up_status"),
        default=FollowUpStatus.SCHEDULED,
        server_default=FollowUpStatus.SCHEDULED.value,
    )
    reason: Mapped[str | None] = mapped_column(Text)
