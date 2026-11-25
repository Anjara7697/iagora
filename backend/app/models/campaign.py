from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint, text, true
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import CampaignStatus
from app.models.mixins import TimestampMixin, str_enum


class Target(Base):
    """Cible commerciale : étudiants eBIHAR, Les Compagnons, Master (candidats / entreprises)."""

    __tablename__ = "targets"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text)


class Campaign(TimestampMixin, Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    responsible_advisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[CampaignStatus] = mapped_column(
        str_enum(CampaignStatus, "campaign_status"), default=CampaignStatus.DRAFT
    )
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Premier contact (D-39) : objet d'email imposé (sinon écrit par l'agent) et ressources validées
    # que l'agent peut partager (liens : nom, adresse, quand l'utiliser).
    email_subject: Mapped[str | None] = mapped_column(String(200))
    resources: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, server_default=text("'[]'")
    )
    # Fiche de campagne (D-52) : offre, dates importantes, conditions et points à éviter, propres
    # à cette campagne. Donnée à l'agent à chaque message, comme source de faits validée.
    brief: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, server_default=text("'{}'"))


class CampaignTarget(Base):
    __tablename__ = "campaign_targets"
    __table_args__ = (UniqueConstraint("campaign_id", "target_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    target_id: Mapped[int] = mapped_column(ForeignKey("targets.id"))


class Source(TimestampMixin, Base):
    """Source de prospects : LinkedIn, Meta, formulaire, landing page, webinaire, import."""

    __tablename__ = "sources"
    __table_args__ = (UniqueConstraint("platform", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(50))
    platform: Mapped[str] = mapped_column(String(50))
    external_id: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(server_default=true())


class CampaignSource(TimestampMixin, Base):
    """Rattachement d'une source à une campagne (F-02)."""

    __tablename__ = "campaign_sources"
    __table_args__ = (UniqueConstraint("campaign_id", "source_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(32), server_default="active")
    start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
