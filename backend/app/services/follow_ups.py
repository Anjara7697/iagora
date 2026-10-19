"""Programmation et éligibilité des relances (F-16)."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampaignProspect, FollowUp
from app.models.enums import ConsentStatus, ConversionStage, FollowUpStatus
from app.services import commercial_context, references
from app.services.errors import ConflictError
from app.services.prospects import get_prospect

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
