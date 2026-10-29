"""Étapes de conversion et affectation des conseillers (F-13, F-22)."""

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampaignProspect, CampaignSource, ScoreEvent, StageEvent, User
from app.models.enums import ConversionStage
from app.schemas.pipeline import (
    EnrollmentConfirmation,
    HistoryRead,
    MembershipUpdate,
    ScoreEventRead,
    StageEventRead,
)
from app.services import campaign_ownership, follow_ups
from app.services.errors import ConflictError, NotFoundError, ValidationFailure

logger = logging.getLogger(__name__)


async def get_membership(session: AsyncSession, membership_id: int) -> CampaignProspect:
    membership = await session.get(CampaignProspect, membership_id)
    if membership is None:
        raise NotFoundError(f"Rattachement {membership_id} introuvable")
    return membership


async def update_membership(
    session: AsyncSession, membership_id: int, data: MembershipUpdate, *, actor: User
) -> CampaignProspect:
    assignment_change = (
        "assigned_advisor_id" in data.model_fields_set or data.inherit_campaign_advisor
    )
    campaign = None
    if assignment_change:
        cid = await session.scalar(
            select(CampaignSource.campaign_id)
            .join(CampaignProspect, CampaignProspect.campaign_source_id == CampaignSource.id)
            .where(CampaignProspect.id == membership_id)
        )
        if cid is None:
            raise NotFoundError(f"Rattachement {membership_id} introuvable")
        campaign = await campaign_ownership.lock_campaign(session, cid)
    membership = await session.scalar(
        select(CampaignProspect)
        .where(CampaignProspect.id == membership_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if membership is None:
        raise NotFoundError(f"Rattachement {membership_id} introuvable")

    if data.conversion_stage is ConversionStage.CONVERTED:
        raise ValidationFailure("Utilisez la confirmation d'inscription avec une preuve vérifiée")

    if assignment_change and campaign is not None:
        advisor_id = (
            await campaign_ownership.inherited_id(session, campaign)
            if data.inherit_campaign_advisor
            else data.assigned_advisor_id
        )
        if not data.inherit_campaign_advisor:
            await campaign_ownership.validate_advisor(session, advisor_id)
        # Réaffectation : l'historique (interactions, scores, étapes) est rattaché au prospect
        # et à la campagne, jamais au conseiller : rien n'est perdu (F-22).
        logger.info(
            "Rattachement %s : conseiller %s -> %s par l'utilisateur %s",
            membership.id, membership.assigned_advisor_id, advisor_id, actor.id,
        )  # fmt: skip
        await session.execute(
            update(CampaignProspect)
            .where(
                CampaignProspect.prospect_id == membership.prospect_id,
                CampaignProspect.campaign_source_id.in_(
                    select(CampaignSource.id).where(CampaignSource.campaign_id == campaign.id)
                ),
            )
            .values(
                assigned_advisor_id=advisor_id,
                assignment_is_override=not data.inherit_campaign_advisor,
            )
        )

    if data.conversion_stage is not None:
        _apply_stage(session, membership, data.conversion_stage, data.reason or "", actor.id)

    if membership.conversion_stage in follow_ups.TERMINAL_STAGES:
        await follow_ups.cancel_for_membership(session, membership.id)
    await session.commit()
    return membership


async def confirm_enrollment(
    session: AsyncSession,
    membership_id: int,
    evidence: EnrollmentConfirmation,
    *,
    actor: User,
) -> CampaignProspect:
    """Confirme une inscription après vérification humaine, une fois par parcours."""
    membership = await session.scalar(
        select(CampaignProspect)
        .where(CampaignProspect.id == membership_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if membership is None:
        raise NotFoundError(f"Rattachement {membership_id} introuvable")
    if membership.conversion_stage is not ConversionStage.APPLIED:
        raise ConflictError("Confirmez d'abord la réception de la candidature sur ce parcours")
    reason = (
        f"Inscription confirmée ; preuve : {evidence.evidence_type} ; "
        f"référence : {evidence.evidence_reference.strip()}"
    )
    if evidence.note and evidence.note.strip():
        reason += f" ; note : {evidence.note.strip()}"
    _apply_stage(session, membership, ConversionStage.CONVERTED, reason, actor.id)
    await follow_ups.cancel_for_membership(session, membership.id)
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
    if membership.conversion_stage in follow_ups.TERMINAL_STAGES:
        await follow_ups.cancel_for_membership(session, membership.id)
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
