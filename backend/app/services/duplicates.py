"""Doublons de prospects : file à trancher et fusion manuelle.

Une réception dont les identifiants appartiennent à deux fiches (l'email sur l'une, le téléphone
sur l'autre) signale la paire (`prospects.flag_duplicates`). Rien n'est fusionné automatiquement :
un téléphone ou une adresse partagés (famille, standard) peuvent relier deux vraies personnes. Un
conseiller ou un administrateur tranche :

- **Fusionner** : la fiche gardée reçoit les identifiants, le profil, les campagnes, l'historique
  (interactions, consentements, relances, rendez-vous, scores) et les conversations de l'autre,
  qui est supprimée. Une désinscription de l'une des deux s'applique à la fiche fusionnée (S-03).
- **Distinctes** : la paire sort de la file et n'y revient pas.

La fusion est rejouable : MongoDB est mis à jour avant PostgreSQL, et si l'étape SQL échoue, la
paire reste à trancher et un nouvel appel termine le travail.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import (
    Appointment,
    CampaignProspect,
    ConsentEvent,
    DuplicateCandidate,
    FollowUp,
    Interaction,
    Prospect,
    ProspectChannel,
    ScoreEvent,
    StageEvent,
)
from app.models.enums import ConsentStatus, Direction, DuplicateStatus, FollowUpStatus
from app.services import scope as scope_service
from app.services.errors import ConflictError, NotFoundError, ValidationFailure
from app.services.prospects import IDENTIFIER_FIELDS

# Collections MongoDB qui portent un `prospect_id` (voir aussi erasure.py).
MONGO_COLLECTIONS = ("conversations", "agent_runs", "agent_events", "meta_lead_events")
ACTIVE_CONVERSATION = ("open", "handed_off")


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Pending:
    candidate: DuplicateCandidate
    first: Prospect
    second: Prospect


def _pending_query(scope: scope_service.Scope) -> Any:
    first, second = aliased(Prospect), aliased(Prospect)
    # Jointures internes : une paire dont une fiche a disparu (effacement, purge) n'apparaît plus.
    return (
        select(DuplicateCandidate, first, second)
        .join(first, first.id == DuplicateCandidate.prospect_id)
        .join(second, second.id == DuplicateCandidate.other_prospect_id)
        .where(
            DuplicateCandidate.status == DuplicateStatus.PENDING,
            scope_service.condition(scope, first.id),
            scope_service.condition(scope, second.id),
        )
    )


async def list_pending(
    session: AsyncSession,
    scope: scope_service.Scope,
    *,
    prospect_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Pending], int]:
    """Paires à trancher visibles dans le périmètre (les deux fiches doivent l'être) ;
    `prospect_id` : seulement celles qui citent cette fiche."""
    query = _pending_query(scope)
    if prospect_id is not None:
        query = query.where(
            or_(
                DuplicateCandidate.prospect_id == prospect_id,
                DuplicateCandidate.other_prospect_id == prospect_id,
            )
        )
    total = int(await session.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = await session.execute(
        query.order_by(DuplicateCandidate.created_at, DuplicateCandidate.id)
        .limit(limit)
        .offset(offset)
    )
    return [Pending(c, a, b) for c, a, b in rows.tuples().all()], total


async def _visible_candidate(
    session: AsyncSession, scope: scope_service.Scope, candidate_id: int
) -> DuplicateCandidate:
    candidate = await session.get(DuplicateCandidate, candidate_id)
    if candidate is None:
        raise NotFoundError("Doublon introuvable")
    try:
        for pid in (candidate.prospect_id, candidate.other_prospect_id):
            await scope_service.ensure_visible(session, scope, pid)
    except NotFoundError:
        raise NotFoundError("Doublon introuvable") from None
    return candidate


async def mark_distinct(
    session: AsyncSession, scope: scope_service.Scope, candidate_id: int, actor_id: int
) -> DuplicateCandidate:
    """Deux personnes différentes : la paire sort de la file. Rejouable."""
    candidate = await _visible_candidate(session, scope, candidate_id)
    if candidate.status is DuplicateStatus.DISTINCT:
        return candidate
    if candidate.status is not DuplicateStatus.PENDING:
        raise ConflictError("Ce doublon a déjà été fusionné")
    candidate.status = DuplicateStatus.DISTINCT
    candidate.resolved_at = _now()
    candidate.resolved_by_user_id = actor_id
    await session.commit()
    return candidate


async def _active_channels(db: Any, prospect_id: int) -> set[str]:
    docs = (
        await db["conversations"]
        .find(
            {"prospect_id": prospect_id, "status": {"$in": list(ACTIVE_CONVERSATION)}},
            {"channel": 1},
        )
        .to_list(None)
    )
    return {d["channel"] for d in docs}


async def _repoint_mongo(db: Any, source: int, target: int) -> None:
    for name in MONGO_COLLECTIONS:
        await db[name].update_many({"prospect_id": source}, {"$set": {"prospect_id": target}})


async def _merge_identity(session: AsyncSession, keep: Prospect, gone: Prospect) -> None:
    moved: dict[str, Any] = {}
    for field in IDENTIFIER_FIELDS:
        value = getattr(gone, field)
        if value and not getattr(keep, field):
            moved[field] = value
        setattr(gone, field, None)  # libère les contraintes d'unicité avant le transfert
    await session.flush()
    for field, value in moved.items():
        setattr(keep, field, value)
    for field in ("first_name", "last_name", "target_id", "origin_channel_id"):
        if getattr(keep, field) is None and getattr(gone, field) is not None:
            setattr(keep, field, getattr(gone, field))
    if keep.current_channel_id is None:
        keep.current_channel_id = gone.current_channel_id
    # Ce que la fiche gardée sait déjà prime ; l'autre complète.
    keep.profile = {**(gone.profile or {}), **(keep.profile or {})}


async def _merge_consent(session: AsyncSession, keep: Prospect, gone: Prospect) -> None:
    """Une désinscription n'est jamais perdue par une fusion (S-03)."""
    if gone.consent_status is ConsentStatus.OPTED_OUT:
        if keep.consent_status is not ConsentStatus.OPTED_OUT:
            keep.consent_status = ConsentStatus.OPTED_OUT
            keep.opted_out_at = gone.opted_out_at or _now()
    elif keep.consent_status is ConsentStatus.UNKNOWN and gone.consent_status is (
        ConsentStatus.GRANTED
    ):
        keep.consent_status = ConsentStatus.GRANTED
        keep.consent_given_at = gone.consent_given_at
        keep.consent_source = gone.consent_source


async def _merge_memberships(session: AsyncSession, keep_id: int, gone_id: int) -> None:
    mine = {
        m.campaign_source_id: m
        for m in await session.scalars(
            select(CampaignProspect).where(CampaignProspect.prospect_id == keep_id)
        )
    }
    theirs = list(
        await session.scalars(
            select(CampaignProspect).where(CampaignProspect.prospect_id == gone_id)
        )
    )
    for membership in theirs:
        same = mine.get(membership.campaign_source_id)
        if same is None:
            membership.prospect_id = keep_id
            continue
        # Même campagne et même source : on garde le rattachement de la fiche gardée (étape,
        # score, conseiller) et on lui rattache l'historique de l'autre.
        for model in (StageEvent, ScoreEvent, FollowUp):
            await session.execute(
                update(model)
                .where(model.campaign_prospect_id == membership.id)
                .values(campaign_prospect_id=same.id)
            )
        same.first_seen_at = min(same.first_seen_at, membership.first_seen_at)
        same.last_seen_at = max(same.last_seen_at, membership.last_seen_at)
        if same.assigned_advisor_id is None and membership.assigned_advisor_id is not None:
            same.assigned_advisor_id = membership.assigned_advisor_id
            same.assignment_is_override = membership.assignment_is_override
        await session.flush()
        await session.delete(membership)


async def _merge_channels(session: AsyncSession, keep_id: int, gone_id: int) -> None:
    mine = set(
        await session.scalars(
            select(ProspectChannel.channel_id).where(ProspectChannel.prospect_id == keep_id)
        )
    )
    for row in await session.scalars(
        select(ProspectChannel).where(ProspectChannel.prospect_id == gone_id)
    ):
        if row.channel_id in mine:
            await session.delete(row)
        else:
            row.prospect_id = keep_id


async def _reroute_candidates(
    session: AsyncSession, current: DuplicateCandidate, keep_id: int, gone_id: int
) -> None:
    """Les autres paires en attente qui citaient la fiche absorbée citent la fiche gardée."""
    others = await session.scalars(
        select(DuplicateCandidate).where(
            DuplicateCandidate.id != current.id,
            DuplicateCandidate.status == DuplicateStatus.PENDING,
            or_(
                DuplicateCandidate.prospect_id == gone_id,
                DuplicateCandidate.other_prospect_id == gone_id,
            ),
        )
    )
    for other in list(others):
        third = other.other_prospect_id if other.prospect_id == gone_id else other.prospect_id
        low, high = sorted((keep_id, third))
        exists = await session.scalar(
            select(DuplicateCandidate.id).where(
                DuplicateCandidate.prospect_id == low, DuplicateCandidate.other_prospect_id == high
            )
        )
        if third == keep_id or exists is not None:
            await session.delete(other)
        else:
            other.prospect_id, other.other_prospect_id = low, high
    await session.flush()


async def merge(
    session: AsyncSession,
    db: Any,
    scope: scope_service.Scope,
    candidate_id: int,
    *,
    keep_id: int,
    actor_id: int,
) -> DuplicateCandidate:
    """Fusionne la paire dans `keep_id` (l'une des deux fiches) et supprime l'autre."""
    candidate = await _visible_candidate(session, scope, candidate_id)
    pair = (candidate.prospect_id, candidate.other_prospect_id)
    if keep_id not in pair:
        raise ValidationFailure("La fiche à garder doit être l'une des deux fiches du doublon")
    gone_id = pair[1] if keep_id == pair[0] else pair[0]
    if candidate.status is DuplicateStatus.MERGED and candidate.kept_prospect_id == keep_id:
        await _repoint_mongo(db, gone_id, keep_id)  # rejeu : termine une trace tardive
        return candidate
    if candidate.status is not DuplicateStatus.PENDING:
        raise ConflictError("Ce doublon a déjà été tranché")

    locked = {
        p.id: p
        for p in await session.scalars(
            select(Prospect)
            .where(Prospect.id.in_(pair))
            .order_by(Prospect.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    if len(locked) != 2:
        raise NotFoundError("L'une des deux fiches n'existe plus")
    keep, gone = locked[keep_id], locked[gone_id]

    clash = await _active_channels(db, keep_id) & await _active_channels(db, gone_id)
    if clash:
        raise ConflictError(
            "Les deux fiches ont une conversation en cours sur le même canal ("
            + ", ".join(sorted(clash))
            + ") : clôturez l'une des deux avant de fusionner"
        )

    await _repoint_mongo(db, gone_id, keep_id)

    await _merge_identity(session, keep, gone)
    await _merge_consent(session, keep, gone)
    for model in (Interaction, Appointment, FollowUp, ScoreEvent, ConsentEvent):
        await session.execute(
            update(model).where(model.prospect_id == gone_id).values(prospect_id=keep_id)
        )
    if keep.consent_status is ConsentStatus.OPTED_OUT:
        # Désinscrit : aucune relance programmée ne survit, y compris celles de l'autre fiche.
        await session.execute(
            update(FollowUp)
            .where(FollowUp.prospect_id == keep_id, FollowUp.status == FollowUpStatus.SCHEDULED)
            .values(status=FollowUpStatus.CANCELLED)
        )
    await _merge_memberships(session, keep_id, gone_id)
    await _merge_channels(session, keep_id, gone_id)
    await _reroute_candidates(session, candidate, keep_id, gone_id)

    candidate.status = DuplicateStatus.MERGED
    candidate.kept_prospect_id = keep_id
    candidate.resolved_at = _now()
    candidate.resolved_by_user_id = actor_id
    session.add(
        Interaction(
            prospect_id=keep_id,
            type="prospects_merged",
            direction=Direction.INBOUND,
            intent=f"Fiche {gone_id} fusionnée, utilisateur {actor_id}",
        )
    )
    await session.flush()
    await session.execute(delete(Prospect).where(Prospect.id == gone_id))
    await session.commit()
    # Un traitement de l'agent en cours a pu écrire une trace sur l'ancienne fiche entre-temps.
    await _repoint_mongo(db, gone_id, keep_id)
    return candidate
