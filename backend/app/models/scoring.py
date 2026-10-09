from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import ScoreType
from app.models.mixins import CreatedAtMixin, str_enum


class ScoreEvent(CreatedAtMixin, Base):
    """Variation de score justifiée et historisée (F-11) : ex. +30, « demande de rendez-vous »."""

    __tablename__ = "score_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), index=True
    )
    campaign_prospect_id: Mapped[int | None] = mapped_column(
        ForeignKey("campaign_prospects.id", ondelete="CASCADE"), index=True
    )
    score_type: Mapped[ScoreType] = mapped_column(str_enum(ScoreType, "score_type"))
    points: Mapped[int]
    reason: Mapped[str] = mapped_column(Text)  # obligatoire : OB-05, F-11
