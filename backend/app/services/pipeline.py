"""Étapes de conversion et affectation des conseillers (F-13, F-22)."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampaignProspect, ScoreEvent, StageEvent, User
from app.models.enums import ConversionStage, UserRole
from app.schemas.pipeline import HistoryRead, MembershipUpdate, ScoreEventRead, StageEventRead
from app.services.errors import NotFoundError, ValidationFailure

logger = logging.getLogger(__name__)

ASSIGNABLE_ROLES = {UserRole.ADVISOR, UserRole.ADMIN}


async def get_membership(session: AsyncSession, membership_id: int) -> CampaignProspect:
    membership = await session.get(CampaignProspect, membership_id)
    if membership is None:
        raise NotFoundError(f"Rattachement {membership_id} introuvable")
    return membership


async def update_membership(
    session: AsyncSession, membership_id: int, data: MembershipUpdate, *, actor: User
) -> CampaignProspect:
    membership = await session.scalar(
        select(CampaignProspect).where(CampaignProspect.id == membership_id).with_for_update()
    )
    if membership is None:
        raise NotFoundError(f"Rattachement {membership_id} introuvable")

    if "assigned_advisor_id" in data.model_fields_set:
        if data.assigned_advisor_id is not None:
            advisor = await session.get(User, data.assigned_advisor_id)
            if advisor is None or not advisor.is_active or advisor.role not in ASSIGNABLE_ROLES:
                raise ValidationFailure("Le conseiller doit être un compte actif ADVISOR ou ADMIN")
        # Réaffectation : l'historique (interactions, scores, étapes) est rattaché au prospect
        # et à la campagne, jamais au conseiller : rien n'est perdu (F-22).
        logger.info(
            "Rattachement %s : conseiller %s -> %s par l'utilisateur %s",
            membership.id, membership.assigned_advisor_id, data.assigned_advisor_id, actor.id,
        )  # fmt: skip
        membership.assigned_advisor_id = data.assigned_advisor_id

    if data.conversion_stage is not None:
        _apply_stage(session, membership, data.conversion_stage, data.reason or "", actor.id)

    await session.commit()
    return membership


def _apply_stage(
    session: AsyncSession,
    membership: CampaignProspect,
    stage: ConversionStage,
    reason: str,
    actor_user_id: int | None,
) -> None:
    """Change l'étape et enregistre l'événement (F-13) ; ne fait rien si l'étape est la même."""
    if stage == membership.conversion_stage:
        return
    session.add(
        StageEvent(
            campaign_prospect_id=membership.id,
            from_stage=membership.conversion_stage,
            to_stage=stage,
            reason=reason.strip(),
            actor_user_id=actor_user_id,
        )
    )
    membership.conversion_stage = stage


async def change_stage(
    session: AsyncSession,
    membership_id: int,
    stage: ConversionStage,
    reason: str,
    *,
    actor_user_id: int | None = None,
) -> CampaignProspect:
    """Changement d'étape décidé par le système (actor_user_id=None : décision automatique)."""
    if not reason.strip():
        raise ValidationFailure("Un changement d'étape doit être justifié")
    membership = await session.scalar(
        select(CampaignProspect).where(CampaignProspect.id == membership_id).with_for_update()
    )
    if membership is None:
        raise NotFoundError(f"Rattachement {membership_id} introuvable")
    _apply_stage(session, membership, stage, reason, actor_user_id)
    await session.commit()
    return membership


async def get_history(session: AsyncSession, membership_id: int) -> HistoryRead:
    await get_membership(session, membership_id)
    stages = await session.scalars(
        select(StageEvent)
        .where(StageEvent.campaign_prospect_id == membership_id)
        .order_by(StageEvent.id)
    )
    scores = await session.scalars(
        select(ScoreEvent)
        .where(ScoreEvent.campaign_prospect_id == membership_id)
        .order_by(ScoreEvent.id)
    )
    return HistoryRead(
        stage_events=[StageEventRead.model_validate(e) for e in stages],
        score_events=[ScoreEventRead.model_validate(e) for e in scores],
    )
