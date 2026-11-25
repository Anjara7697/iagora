"""Programmation et éligibilité des relances (F-16)."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import CampaignProspect, Channel, FollowUp, Prospect, User
from app.models.enums import ConsentStatus, ConversionStage, FollowUpStatus
from app.schemas.follow_up import PlannedFollowUp
from app.services import commercial_context, references
from app.services import scope as scope_service
from app.services.demo import demo_filter
from app.services.errors import ConflictError, NotFoundError, ValidationFailure
from app.services.prospects import get_prospect
from app.services.scope import EVERYTHING, Scope
from app.services.send_window import next_send_time

logger = logging.getLogger(__name__)


TERMINAL_STAGES = frozenset({ConversionStage.CONVERTED, ConversionStage.LOST})


async def eligible_membership(
    session: AsyncSession, prospect_id: int, membership_id: int | None
) -> CampaignProspect:
    """Une relance ne doit pas changer de parcours ni reprendre un parcours terminé."""
    selected = (await commercial_context.memberships(session, [prospect_id])).get(prospect_id)
    if selected is None:
        raise ConflictError("Relance impossible : aucun parcours commercial")
    if membership_id is not None and selected.id != membership_id:
        raise ConflictError("Relance impossible : le contexte commercial a changé")
    # Même verrou que le changement d'étape : programmation et conversion sont sérialisées.
    membership = await session.scalar(
        select(CampaignProspect)
        .where(CampaignProspect.id == selected.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if membership is None or membership.conversion_stage in TERMINAL_STAGES:
        raise ConflictError("Relance impossible : parcours converti ou perdu")
    return membership


async def cancel_for_membership(session: AsyncSession, membership_id: int) -> None:
    """Annule dans la transaction du changement d'étape, sans toucher aux autres parcours."""
    await session.execute(
        update(FollowUp)
        .where(
            FollowUp.campaign_prospect_id == membership_id,
            FollowUp.status == FollowUpStatus.SCHEDULED,
        )
        .values(status=FollowUpStatus.CANCELLED)
    )


async def schedule_follow_up(
    session: AsyncSession,
    prospect_id: int,
    membership_id: int | None,
    channel_name: str | None,
    delay: timedelta,
    reason: str,
) -> FollowUp:
    prospect = await get_prospect(session, prospect_id)
    if prospect.consent_status is ConsentStatus.OPTED_OUT:
        raise ConflictError("Le prospect s'est désinscrit : aucune relance (S-03)")
    membership = await eligible_membership(session, prospect_id, membership_id)
    channel = await references.get_channel(session, channel_name)
    follow_up = FollowUp(
        prospect_id=prospect_id,
        campaign_prospect_id=membership.id,
        channel_id=channel.id if channel else None,
        scheduled_at=datetime.now(UTC) + delay,
        reason=reason,
    )
    session.add(follow_up)
    await session.commit()
    logger.info("Relance %s programmée dans %s : %s", follow_up.id, delay, reason)
    return follow_up


async def cancel_pending(session: AsyncSession, prospect_id: int) -> int:
    """Annule les relances en attente d'un prospect. Retourne leur nombre.

    À appeler dès que le prospect écrit, qu'un conseiller reprend la conversation ou qu'elle est
    clôturée : une relance ne doit jamais partir vers quelqu'un qui est déjà en échange (F-16).
    """
    pending = list(
        await session.scalars(
            select(FollowUp).where(
                FollowUp.prospect_id == prospect_id, FollowUp.status == FollowUpStatus.SCHEDULED
            )
        )
    )
    for follow_up in pending:
        follow_up.status = FollowUpStatus.CANCELLED
    if pending:
        await session.commit()
        logger.info("%d relance(s) annulée(s) pour le prospect %s", len(pending), prospect_id)
    return len(pending)


# --- Relances prévues, vues et corrigées par un conseiller ---

MAX_RESCHEDULE = timedelta(days=90)
_GONE = "Cette relance est déjà partie ou a été annulée"


def _display_name(p: Prospect) -> str:
    full = " ".join(x for x in (p.first_name, p.last_name) if x)
    return full or p.email or f"Prospect {p.id}"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _planned(f: FollowUp, p: Prospect, channel: str | None, settings: Settings) -> PlannedFollowUp:
    at = _aware(f.scheduled_at)
    return PlannedFollowUp(
        id=f.id,
        prospect_id=p.id,
        prospect_name=_display_name(p),
        channel=channel,
        scheduled_at=at,
        expected_at=next_send_time(at, settings),
        reason=f.reason,
    )


async def list_planned(
    session: AsyncSession,
    settings: Settings,
    *,
    scope: Scope = EVERYTHING,
    prospect_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[PlannedFollowUp], int]:
    """Relances en attente, la plus proche d'abord, dans le périmètre du conseiller.

    La liste générale écarte les prospects fictifs (comme « Aujourd'hui » et l'exécuteur, qui ne
    les relance pas) ; la liste d'un prospect les montre, pour la recette.
    """
    where = [
        FollowUp.status == FollowUpStatus.SCHEDULED,
        scope_service.condition(scope, FollowUp.prospect_id),
    ]
    if prospect_id is not None:
        where.append(FollowUp.prospect_id == prospect_id)
    else:
        where.append(~demo_filter())
    total = (
        await session.scalar(
            select(func.count())
            .select_from(FollowUp)
            .join(Prospect, Prospect.id == FollowUp.prospect_id)
            .where(*where)
        )
        or 0
    )
    rows = await session.execute(
        select(FollowUp, Prospect, Channel.name)
        .join(Prospect, Prospect.id == FollowUp.prospect_id)
        .outerjoin(Channel, Channel.id == FollowUp.channel_id)
        .where(*where)
        .order_by(FollowUp.scheduled_at, FollowUp.id)
        .limit(limit)
        .offset(offset)
    )
    return [_planned(f, p, c, settings) for f, p, c in rows], int(total)


async def _visible(session: AsyncSession, scope: Scope, follow_up_id: int) -> FollowUp:
    follow_up = await session.get(FollowUp, follow_up_id)
    if follow_up is None:
        raise NotFoundError("Relance introuvable")
    try:
        await scope_service.ensure_visible(session, scope, follow_up.prospect_id)
    except NotFoundError:
        raise NotFoundError("Relance introuvable") from None  # hors périmètre : rien n'est révélé
    return follow_up


async def cancel_by_user(
    session: AsyncSession, scope: Scope, follow_up_id: int, user: User
) -> None:
    """Annule une relance précise. L'agent pourra en programmer une autre s'il écrit de nouveau.

    La mise à jour ne touche qu'une relance encore en attente : si l'exécuteur l'a réclamée entre
    l'affichage et le clic, on répond 409 au lieu de prétendre l'avoir arrêtée.
    """
    follow_up = await _visible(session, scope, follow_up_id)
    note = f"{follow_up.reason or 'Relance'} — annulée par {user.username}"[:1000]
    result = await session.execute(
        update(FollowUp)
        .where(FollowUp.id == follow_up_id, FollowUp.status == FollowUpStatus.SCHEDULED)
        .values(status=FollowUpStatus.CANCELLED, reason=note)
    )
    if not result.rowcount:  # type: ignore[attr-defined]
        await session.rollback()
        raise ConflictError(_GONE)
    await session.commit()
    logger.info("Relance %s annulée par l'utilisateur %s", follow_up_id, user.id)


async def reschedule(
    session: AsyncSession,
    settings: Settings,
    scope: Scope,
    follow_up_id: int,
    at: datetime,
    user: User,
    *,
    now: datetime | None = None,
) -> PlannedFollowUp:
    """Déplace une relance en attente. Les garde-fous d'exécution (fenêtre, désinscription,
    réponse du prospect, plafond) restent appliqués à la nouvelle heure."""
    now = now or datetime.now(UTC)
    if at.tzinfo is None:
        raise ValidationFailure("L'heure de la relance doit préciser son fuseau horaire")
    if at <= now:
        raise ValidationFailure("La nouvelle heure de relance doit être dans le futur")
    if at > now + MAX_RESCHEDULE:
        raise ValidationFailure("Une relance ne peut pas être décalée de plus de 90 jours")
    at = at.astimezone(UTC)  # stockée en UTC, comme celles de l'agent
    await _visible(session, scope, follow_up_id)
    result = await session.execute(
        update(FollowUp)
        .where(FollowUp.id == follow_up_id, FollowUp.status == FollowUpStatus.SCHEDULED)
        .values(scheduled_at=at)
    )
    if not result.rowcount:  # type: ignore[attr-defined]
        await session.rollback()
        raise ConflictError(_GONE)
    await session.commit()
    logger.info("Relance %s décalée au %s par l'utilisateur %s", follow_up_id, at, user.id)
    follow_up = await session.get(FollowUp, follow_up_id, populate_existing=True)
    assert follow_up is not None  # noqa: S101 - vient d'être mise à jour
    prospect = await get_prospect(session, follow_up.prospect_id)
    channel = await session.get(Channel, follow_up.channel_id) if follow_up.channel_id else None
    return _planned(follow_up, prospect, channel.name if channel else None, settings)
