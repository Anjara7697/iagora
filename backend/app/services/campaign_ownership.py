"""Responsable de campagne, héritage et exceptions individuelles.

Les écritures d'affectation verrouillent la campagne avant ses rattachements.
Les scores, étapes, conversations et dates d'activité ne sont pas modifiés.
"""

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Campaign, CampaignProspect, CampaignSource, User
from app.models.enums import UserRole
from app.schemas.campaign import CampaignOwnershipUpdate
from app.services.errors import NotFoundError, ValidationFailure

logger = logging.getLogger(__name__)


async def lock_campaign(session: AsyncSession, campaign_id: int) -> Campaign:
    campaign = await session.scalar(
        select(Campaign)
        .where(Campaign.id == campaign_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if campaign is None:
        raise NotFoundError("Campagne introuvable")
    return campaign


async def validate_advisor(session: AsyncSession, advisor_id: int | None) -> None:
    if advisor_id is None:
        return
    user = await session.get(User, advisor_id)
    if user is None or not user.is_active or user.role not in (UserRole.ADMIN, UserRole.ADVISOR):
        raise ValidationFailure("Le conseiller doit être un compte actif ADVISOR ou ADMIN")


async def inherited_id(session: AsyncSession, campaign: Campaign) -> int | None:
    if campaign.responsible_advisor_id is None:
        return None
    user = await session.get(User, campaign.responsible_advisor_id)
    if user is None or not user.is_active or user.role not in (UserRole.ADMIN, UserRole.ADVISOR):
        return None
    return user.id


async def initial_assignment(
    session: AsyncSession, campaign_id: int, prospect_id: int
) -> tuple[int | None, bool]:
    campaign = await lock_campaign(session, campaign_id)
    exception = await session.scalar(
        select(CampaignProspect)
        .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
        .where(
            CampaignSource.campaign_id == campaign_id,
            CampaignProspect.prospect_id == prospect_id,
            CampaignProspect.assignment_is_override.is_(True),
        )
        .order_by(CampaignProspect.last_seen_at.desc(), CampaignProspect.id.desc())
        .limit(1)
    )
    if exception is not None:
        return exception.assigned_advisor_id, True
    return await inherited_id(session, campaign), False


async def set_responsible(
    session: AsyncSession, campaign_id: int, payload: CampaignOwnershipUpdate, actor_id: int
) -> Campaign:
    campaign = await lock_campaign(session, campaign_id)
    await validate_advisor(session, payload.advisor_id)
    previous = campaign.responsible_advisor_id
    if previous == payload.advisor_id:
        await session.commit()
        return campaign
    inherited = update(CampaignProspect).where(
        CampaignProspect.campaign_source_id.in_(
            select(CampaignSource.id).where(CampaignSource.campaign_id == campaign_id)
        ),
        CampaignProspect.assignment_is_override.is_(False),
    )
    if payload.existing_prospects == "transfer_inherited":
        await session.execute(inherited.values(assigned_advisor_id=payload.advisor_id))
    else:
        # Figer les attributions existantes, y compris l'absence de conseiller.
        await session.execute(inherited.values(assignment_is_override=True))
    campaign.responsible_advisor_id = payload.advisor_id
    await session.commit()
    logger.info(
        "Campagne %s : responsable %s -> %s, politique %s, utilisateur %s",
        campaign_id,
        previous,
        payload.advisor_id,
        payload.existing_prospects,
        actor_id,
    )
    return campaign
