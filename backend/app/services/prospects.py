"""Réception, déduplication et consentement des prospects (F-04, F-05, F-06, S-03)."""

import logging
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CampaignProspect,
    CampaignSource,
    ConsentEvent,
    FollowUp,
    Interaction,
    Prospect,
)
from app.models.enums import (
    ConsentEventType,
    ConsentStatus,
    Direction,
    FollowUpStatus,
)
from app.schemas.prospect import ProspectIngest, ProspectUpdate
from app.services import references
from app.services.errors import ConflictError, NotFoundError, ValidationFailure

logger = logging.getLogger(__name__)

# Ordre de priorité pour reconnaître un prospect existant.
IDENTIFIER_FIELDS = ("email", "phone", "linkedin_id", "facebook_id", "instagram_id")


def _now() -> datetime:
    return datetime.now(UTC)


async def _find_by(session: AsyncSession, field: str, value: str) -> Prospect | None:
    column = func.lower(Prospect.email) if field == "email" else getattr(Prospect, field)
    return (await session.scalars(select(Prospect).where(column == value))).first()


async def find_existing(session: AsyncSession, data: ProspectIngest) -> Prospect | None:
    """Recherche par identifiant disponible, par ordre de priorité (F-05)."""
    matches: list[Prospect] = []
    for field in IDENTIFIER_FIELDS:
        value = getattr(data, field)
        if value and (found := await _find_by(session, field, value)):
            matches.append(found)
    if len({p.id for p in matches}) > 1:
        # Identifiants rattachés à des fiches différentes : on ne fusionne pas automatiquement.
        logger.warning(
            "Identifiants ambigus, fiches %s ; retenue : %s", [p.id for p in matches], matches[0].id
        )
    return matches[0] if matches else None


async def _enrich(session: AsyncSession, prospect: Prospect, data: ProspectIngest) -> None:
    """Complète uniquement les champs vides, si la valeur n'appartient pas à une autre fiche."""
    for field in ("first_name", "last_name", *IDENTIFIER_FIELDS):
        value = getattr(data, field)
        if value and not getattr(prospect, field):
            if field in IDENTIFIER_FIELDS and await _find_by(session, field, value):
                continue
            setattr(prospect, field, value)
    if data.profile:
        prospect.profile = {**prospect.profile, **data.profile}


async def _resolve_campaign_source(
    session: AsyncSession, data: ProspectIngest
) -> CampaignSource | None:
    if data.campaign_id is None and data.source_id is None:
        return None
    if data.campaign_id is None or data.source_id is None:
        raise ValidationFailure("campaign_id et source_id doivent être fournis ensemble")
    cs = await session.scalar(
        select(CampaignSource).where(
            CampaignSource.campaign_id == data.campaign_id,
            CampaignSource.source_id == data.source_id,
        )
    )
    if cs is None:
        raise ValidationFailure("Cette source n'est pas rattachée à cette campagne")
    return cs


async def _record_consent(
    session: AsyncSession,
    prospect: Prospect,
    event_type: ConsentEventType,
    source: str,
    channel_id: int | None = None,
) -> None:
    now = _now()
    if event_type is ConsentEventType.GRANTED:
        prospect.consent_status = ConsentStatus.GRANTED
        prospect.consent_given_at = now
        prospect.consent_source = source
        prospect.opted_out_at = None
    else:
        prospect.consent_status = ConsentStatus.OPTED_OUT
        prospect.opted_out_at = now
    session.add(
        ConsentEvent(
            prospect_id=prospect.id,
            channel_id=channel_id,
            event_type=event_type,
            source=source,
            occurred_at=now,
        )
    )


async def ingest_prospect(
    session: AsyncSession, data: ProspectIngest
) -> tuple[Prospect, bool, Interaction]:
    """Enregistre un prospect reçu (F-04) : déduplication (F-05), rattachement à la campagne
    (F-03), canal (F-07) et interaction d'entrée (F-06). Retourne (prospect, créé, interaction)."""
    if not data.has_identifier():
        raise ValidationFailure("Au moins un identifiant est requis (email, téléphone, id réseau)")

    channel = await references.get_channel(session, data.channel)
    target = await references.get_target(session, data.target_code)
    campaign_source = await _resolve_campaign_source(session, data)

    prospect = await find_existing(session, data)
    created = prospect is None
    if prospect is None:
        prospect = Prospect(
            first_name=data.first_name,
            last_name=data.last_name,
            email=data.email,
            phone=data.phone,
            linkedin_id=data.linkedin_id,
            facebook_id=data.facebook_id,
            instagram_id=data.instagram_id,
            target_id=target.id if target else None,
            origin_channel_id=channel.id if channel else None,
            profile=dict(data.profile),
        )
        try:
            async with session.begin_nested():
                session.add(prospect)
                await session.flush()
        except IntegrityError:
            # Création concurrente du même prospect : on reprend la fiche gagnante.
            session.expunge(prospect)
            prospect = await find_existing(session, data)
            if prospect is None:
                raise ConflictError("Conflit lors de la création du prospect") from None
            created = False

    if not created:
        await _enrich(session, prospect, data)
        if target and prospect.target_id is None:
            prospect.target_id = target.id
    if channel:
        prospect.current_channel_id = channel.id

    # Un opt-out n'est jamais levé par une réception automatique : seul un nouveau
    # consentement explicite (POST /prospects/{id}/consent) le fait (S-03).
    if data.consent_granted and prospect.consent_status is not ConsentStatus.OPTED_OUT:
        await _record_consent(
            session,
            prospect,
            ConsentEventType.GRANTED,
            data.consent_source or "ingestion",
            channel.id if channel else None,
        )

    if campaign_source is not None:
        membership = await session.scalar(
            select(CampaignProspect).where(
                CampaignProspect.campaign_source_id == campaign_source.id,
                CampaignProspect.prospect_id == prospect.id,
            )
        )
        if membership is None:
            session.add(
                CampaignProspect(campaign_source_id=campaign_source.id, prospect_id=prospect.id)
            )
        else:
            membership.last_seen_at = _now()

    interaction = await _record_entry(session, prospect, channel.id if channel else None, data)
    await session.commit()
    return prospect, created, interaction


async def _record_entry(
    session: AsyncSession, prospect: Prospect, channel_id: int | None, data: ProspectIngest
) -> Interaction:
    if channel_id and data.external_id:
        existing = await session.scalar(
            select(Interaction).where(
                Interaction.channel_id == channel_id,
                Interaction.external_id == data.external_id,
            )
        )
        if existing:  # webhook rejoué : pas de doublon (NF-05)
            return existing
    interaction = Interaction(
        prospect_id=prospect.id,
        channel_id=channel_id,
        type="lead_received",
        direction=Direction.INBOUND,
        content=data.message,
        external_id=data.external_id,
    )
    session.add(interaction)
    await session.flush()
    return interaction


async def get_prospect(session: AsyncSession, prospect_id: int) -> Prospect:
    prospect = await session.get(Prospect, prospect_id)
    if prospect is None:
        raise NotFoundError(f"Prospect {prospect_id} introuvable")
    return prospect


async def get_memberships(session: AsyncSession, prospect_id: int) -> list[CampaignProspect]:
    result = await session.scalars(
        select(CampaignProspect)
        .where(CampaignProspect.prospect_id == prospect_id)
        .order_by(CampaignProspect.id)
    )
    return list(result)


async def get_memberships_for(
    session: AsyncSession, prospect_ids: list[int]
) -> dict[int, list[CampaignProspect]]:
    """Rattachements de plusieurs prospects en une requête (évite un appel par ligne)."""
    grouped: dict[int, list[CampaignProspect]] = {pid: [] for pid in prospect_ids}
    if prospect_ids:
        rows = await session.scalars(
            select(CampaignProspect)
            .where(CampaignProspect.prospect_id.in_(prospect_ids))
            .order_by(CampaignProspect.id)
        )
        for m in rows:
            grouped[m.prospect_id].append(m)
    return grouped


async def list_prospects(
    session: AsyncSession,
    *,
    q: str | None,
    campaign_id: int | None,
    stage: str | None,
    advisor_id: int | None,
    limit: int,
    offset: int,
) -> tuple[list[Prospect], int]:
    stmt = select(Prospect)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(func.coalesce(Prospect.first_name, "")).like(like),
                func.lower(func.coalesce(Prospect.last_name, "")).like(like),
                func.lower(func.coalesce(Prospect.email, "")).like(like),
            )
        )
    if campaign_id is not None or stage is not None or advisor_id is not None:
        cp = select(CampaignProspect.prospect_id).join(
            CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id
        )
        if campaign_id is not None:
            cp = cp.where(CampaignSource.campaign_id == campaign_id)
        if stage is not None:
            cp = cp.where(CampaignProspect.conversion_stage == stage)
        if advisor_id is not None:
            cp = cp.where(CampaignProspect.assigned_advisor_id == advisor_id)
        stmt = stmt.where(Prospect.id.in_(cp))
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = await session.scalars(stmt.order_by(Prospect.id.desc()).limit(limit).offset(offset))
    return list(items), total


async def update_prospect(
    session: AsyncSession, prospect_id: int, data: ProspectUpdate
) -> Prospect:
    prospect = await get_prospect(session, prospect_id)
    changes = data.model_dump(exclude_unset=True)
    target = await references.get_target(session, changes.pop("target_code", None))
    if target:
        prospect.target_id = target.id
    for field, value in changes.items():
        setattr(prospect, field, value)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Un autre prospect utilise déjà cet identifiant") from None
    return prospect


async def opt_out(
    session: AsyncSession, prospect_id: int, source: str, channel_name: str | None
) -> Prospect:
    """Enregistre l'opt-out et annule les relances à venir (S-03, F-16). Idempotent."""
    prospect = await get_prospect(session, prospect_id)
    if prospect.consent_status is not ConsentStatus.OPTED_OUT:
        channel = await references.get_channel(session, channel_name)
        await _record_consent(
            session, prospect, ConsentEventType.WITHDRAWN, source, channel.id if channel else None
        )
        pending = await session.scalars(
            select(FollowUp).where(
                FollowUp.prospect_id == prospect_id, FollowUp.status == FollowUpStatus.SCHEDULED
            )
        )
        for follow_up in pending:
            follow_up.status = FollowUpStatus.CANCELLED
        await session.commit()
    return prospect


async def grant_consent(
    session: AsyncSession, prospect_id: int, source: str, channel_name: str | None
) -> Prospect:
    prospect = await get_prospect(session, prospect_id)
    channel = await references.get_channel(session, channel_name)
    await _record_consent(
        session, prospect, ConsentEventType.GRANTED, source, channel.id if channel else None
    )
    await session.commit()
    return prospect
