from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import ConsentStatus, ConversionStage, InterestLevel
from app.models.mixins import CreatedAtMixin, TimestampMixin, str_enum


class Prospect(TimestampMixin, Base):
    """Fiche prospect unique. Les identifiants (email, téléphone, ids de plateformes) sont
    uniques pour permettre la déduplication (F-05)."""

    __tablename__ = "prospects"
    __table_args__ = (Index("uq_prospects_email_lower", func.lower(text("email")), unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50), unique=True)
    linkedin_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    facebook_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    instagram_id: Mapped[str | None] = mapped_column(String(255), unique=True)

    target_id: Mapped[int | None] = mapped_column(ForeignKey("targets.id", ondelete="SET NULL"))
    # F-07 : canal d'origine et canal courant stockés séparément (le canal préféré
    # et les canaux disponibles sont dans prospect_channels).
    origin_channel_id: Mapped[int | None] = mapped_column(
        ForeignKey("channels.id", ondelete="SET NULL")
    )
    current_channel_id: Mapped[int | None] = mapped_column(
        ForeignKey("channels.id", ondelete="SET NULL")
    )
    # F-09 : informations de profil / qualification déjà obtenues, pour ne jamais les redemander.
    profile: Mapped[dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), default=dict, server_default=text("'{}'")
    )

    # S-03 : consentement et opt-out (historique détaillé : consent_events).
    consent_status: Mapped[ConsentStatus] = mapped_column(
        str_enum(ConsentStatus, "consent_status"),
        default=ConsentStatus.UNKNOWN,
        server_default=ConsentStatus.UNKNOWN.value,
    )
    consent_source: Mapped[str | None] = mapped_column(String(100))
    consent_given_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    opted_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CampaignProspect(TimestampMixin, Base):
    """Rattachement prospect <-> campagne via une source ; porte score et étape (F-03)."""

    __tablename__ = "campaign_prospects"
    __table_args__ = (UniqueConstraint("campaign_source_id", "prospect_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_source_id: Mapped[int] = mapped_column(ForeignKey("campaign_sources.id"))
    prospect_id: Mapped[int] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), index=True
    )
    interest_status: Mapped[InterestLevel | None] = mapped_column(
        str_enum(InterestLevel, "interest_level")
    )
    conversion_stage: Mapped[ConversionStage] = mapped_column(
        str_enum(ConversionStage, "conversion_stage"),
        default=ConversionStage.NEW,
        server_default=ConversionStage.NEW.value,
    )
    interest_score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    fit_score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total_score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    assigned_advisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class StageEvent(CreatedAtMixin, Base):
    """Historique horodaté des changements d'étape (F-13, OB-05)."""

    __tablename__ = "stage_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_prospect_id: Mapped[int] = mapped_column(
        ForeignKey("campaign_prospects.id", ondelete="CASCADE"), index=True
    )
    from_stage: Mapped[ConversionStage | None] = mapped_column(
        str_enum(ConversionStage, "stage_event_from")
    )
    to_stage: Mapped[ConversionStage] = mapped_column(str_enum(ConversionStage, "stage_event_to"))
    reason: Mapped[str | None] = mapped_column(Text)
