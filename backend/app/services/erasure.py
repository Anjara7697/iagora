"""Droit à l'effacement (RGPD, art. 17) et durée de conservation.

Effacer un prospect supprime sa fiche PostgreSQL (les clés `ON DELETE CASCADE` emportent
interactions, rendez-vous, relances, étapes, scores et consentements) et ses données MongoDB
(conversation, décisions de l'agent, événements). Il ne reste qu'une trace sans donnée lisible
(`ErasureRecord`) ; si la personne s'est désinscrite ou a demandé l'effacement, l'empreinte de son
email et de son téléphone est gardée pour qu'un import ou un nouveau message ne la fasse pas
recontacter. Les emails de la boîte de l'école et les événements Google / Zoom déjà créés ne sont
pas touchés : le rapport les liste pour qu'une personne les supprime.
"""

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Appointment,
    CampaignProspect,
    ErasureRecord,
    FollowUp,
    Interaction,
    Prospect,
    User,
)
from app.models.enums import (
    AppointmentStatus,
    ConsentStatus,
    ConversionStage,
    FollowUpStatus,
)
from app.schemas.erasure import ErasureReport, ExternalEvent
from app.services.errors import NotFoundError

REASONS = ("request", "retention", "other")
_SALT = "iagora-suppression-v1:"
MONGO_COLLECTIONS = ("conversations", "agent_runs", "agent_events")


def fingerprint(value: str | None, *, phone: bool = False) -> str | None:
    """Empreinte stable d'une adresse ou d'un numéro (pseudonymisation, pas anonymisation)."""
    if not value:
        return None
    normalized = re.sub(r"[^\d+]", "", value) if phone else value.strip().lower()
    if not normalized:
        return None
    return hashlib.sha256(f"{_SALT}{normalized}".encode()).hexdigest()


async def is_suppressed(session: AsyncSession, *, email: str | None, phone: str | None) -> bool:
    """Cette adresse ou ce numéro appartient-il à une personne à ne plus recontacter ?"""
    conditions = []
    if (email_hash := fingerprint(email)) is not None:
        conditions.append(ErasureRecord.email_hash == email_hash)
    if (phone_hash := fingerprint(phone, phone=True)) is not None:
        conditions.append(ErasureRecord.phone_hash == phone_hash)
    if not conditions:
        return False
    found = await session.scalar(
        select(ErasureRecord.id)
        .where(ErasureRecord.keep_suppressed.is_(True), or_(*conditions))
        .limit(1)
    )
    return found is not None


async def _delete_mongo(db: Any, prospect_id: int) -> int:
    conversations = 0
    for name in MONGO_COLLECTIONS:
        result = await db[name].delete_many({"prospect_id": prospect_id})
        if name == "conversations":
            conversations = int(result.deleted_count)
    return conversations


async def erase_prospect(
    session: AsyncSession, db: Any, prospect_id: int, *, reason: str, actor_id: int | None
) -> ErasureReport:
    """Efface définitivement un prospect. Rejouable : si l'étape SQL échoue après MongoDB, la fiche
    existe encore et un nouvel appel termine le travail."""
    if reason not in REASONS:
        raise ValueError(f"motif inconnu : {reason}")
    prospect = await session.get(Prospect, prospect_id)
    if prospect is None:
        raise NotFoundError("Prospect introuvable")
    appointments = list(
        await session.scalars(select(Appointment).where(Appointment.prospect_id == prospect_id))
    )
    advisor_ids = {a.advisor_id for a in appointments if a.advisor_id}
    names: dict[int, str] = {}
    if advisor_ids:
        rows = await session.execute(select(User.id, User.username).where(User.id.in_(advisor_ids)))
        names = dict(rows.tuples().all())
    external = [
        ExternalEvent(
            start_at=a.start_at,
            advisor=names.get(a.advisor_id) if a.advisor_id else None,
            calendar_event_id=a.calendar_event_id,
            zoom_meeting_id=a.zoom_meeting_id,
            meeting_url=a.meeting_url,
        )
        for a in appointments
        if a.calendar_event_id or a.zoom_meeting_id or a.meeting_url
    ]
    interactions = int(
        await session.scalar(
            select(func.count())
            .select_from(Interaction)
            .where(Interaction.prospect_id == prospect_id)
        )
        or 0
    )
    keep = prospect.consent_status is ConsentStatus.OPTED_OUT or reason == "request"
    session.add(
        ErasureRecord(
            former_prospect_id=prospect_id,
            reason=reason,
            keep_suppressed=keep,
            email_hash=fingerprint(prospect.email) if keep else None,
            phone_hash=fingerprint(prospect.phone, phone=True) if keep else None,
            actor_user_id=actor_id,
        )
    )
    conversations = await _delete_mongo(db, prospect_id)
    await session.execute(delete(Prospect).where(Prospect.id == prospect_id))
    await session.commit()
    session.expunge_all()
    # Un traitement de l'agent en cours a pu réécrire une trace entre-temps.
    conversations += await _delete_mongo(db, prospect_id)
    return ErasureReport(
        prospect_id=prospect_id,
        conversations=conversations,
        interactions=interactions,
        appointments=len(appointments),
        suppressed=keep,
        external_events=external,
    )


@dataclass(frozen=True)
class Inactive:
    prospect_id: int
    last_activity: datetime


async def inactive_prospects(
    session: AsyncSession,
    *,
    older_than_days: int,
    include_converted: bool = False,
    now: datetime | None = None,
) -> list[Inactive]:
    """Prospects sans aucun échange ni modification depuis `older_than_days` jours, sans rendez-vous
    à venir ni relance programmée. Les prospects convertis sont gardés sauf demande contraire."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=older_than_days)
    last_message = func.max(Interaction.created_at)
    query = (
        select(Prospect.id, func.coalesce(last_message, Prospect.created_at))
        .outerjoin(Interaction, Interaction.prospect_id == Prospect.id)
        .where(
            Prospect.updated_at < cutoff,
            ~exists().where(
                Appointment.prospect_id == Prospect.id,
                Appointment.end_at >= now,
                Appointment.status.in_([AppointmentStatus.PROPOSED, AppointmentStatus.SCHEDULED]),
            ),
            ~exists().where(
                FollowUp.prospect_id == Prospect.id, FollowUp.status == FollowUpStatus.SCHEDULED
            ),
        )
        .group_by(Prospect.id)
        .having(func.coalesce(last_message, Prospect.created_at) < cutoff)
        .order_by(Prospect.id)
    )
    if not include_converted:
        query = query.where(
            ~exists().where(
                CampaignProspect.prospect_id == Prospect.id,
                CampaignProspect.conversion_stage == ConversionStage.CONVERTED,
            )
        )
    return [Inactive(pid, seen) for pid, seen in (await session.execute(query)).all()]
