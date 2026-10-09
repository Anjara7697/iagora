"""Scoring des prospects (F-10, F-11, F-12) : chaque variation est justifiée et historisée.

Deux composantes entre 0 et 100 : l'intérêt (engagement, intention) et l'adéquation (profil).
Le score total en est la moyenne pondérée. Les poids, seuils et règles ci-dessous sont des
valeurs de conception, ajustables après validation métier (CdC §4.2).
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampaignProspect, ScoreEvent
from app.models.enums import InterestLevel, ScoreType, ScoringSignal
from app.services.errors import NotFoundError, ValidationFailure

logger = logging.getLogger(__name__)

MIN_SCORE, MAX_SCORE = 0, 100
INTEREST_WEIGHT, FIT_WEIGHT = 0.6, 0.4

# Niveau d'intérêt (F-12) selon le score total : (seuil minimal, niveau), du plus haut au plus bas.
LEVEL_THRESHOLDS = [
    (75, InterestLevel.VERY_HOT),
    (50, InterestLevel.HOT),
    (25, InterestLevel.WARM),
]

# Règles : signal -> (composante, points, justification enregistrée).
SIGNAL_RULES: dict[ScoringSignal, tuple[ScoreType, int, str]] = {
    ScoringSignal.MESSAGE_RECEIVED: (ScoreType.INTEREST, 5, "Le prospect a répondu"),
    ScoringSignal.QUESTION_ASKED: (ScoreType.INTEREST, 8, "Le prospect pose une question"),
    ScoringSignal.POSITIVE_SENTIMENT: (ScoreType.INTEREST, 10, "Sentiment positif exprimé"),
    ScoringSignal.NEGATIVE_SENTIMENT: (ScoreType.INTEREST, -15, "Sentiment négatif exprimé"),
    ScoringSignal.MEETING_REQUESTED: (ScoreType.INTEREST, 30, "Demande de rendez-vous"),
    ScoringSignal.MEETING_DECLINED: (ScoreType.INTEREST, -10, "Rendez-vous refusé"),
    ScoringSignal.NO_RESPONSE: (ScoreType.INTEREST, -5, "Relance restée sans réponse"),
    ScoringSignal.PROFILE_TARGET_MATCH: (ScoreType.FIT, 20, "Profil correspondant à la cible"),
    ScoringSignal.PROFILE_COMPLETED: (ScoreType.FIT, 10, "Informations de qualification complètes"),
}


def clamp(value: int) -> int:
    return max(MIN_SCORE, min(MAX_SCORE, value))


def compute_total(interest: int, fit: int) -> int:
    return clamp(round(INTEREST_WEIGHT * interest + FIT_WEIGHT * fit))


def level_for(total: int) -> InterestLevel:
    for threshold, level in LEVEL_THRESHOLDS:
        if total >= threshold:
            return level
    return InterestLevel.COLD


async def apply_score(
    session: AsyncSession,
    membership_id: int,
    score_type: ScoreType,
    points: int,
    reason: str,
    *,
    actor_user_id: int | None = None,
) -> tuple[CampaignProspect, list[ScoreEvent]]:
    """Applique une variation à `interest` ou `fit`, recalcule le total et le niveau d'intérêt,
    et enregistre les événements. Retourne (rattachement, événements créés) ; aucun événement
    si le score ne change pas (déjà au plafond, par exemple)."""
    if score_type is ScoreType.TOTAL:
        raise ValidationFailure("Le score total est calculé ; ajuster interest ou fit")
    if not reason.strip():
        raise ValidationFailure("Toute variation de score doit être justifiée (F-11)")

    # Verrou de ligne : deux variations simultanées ne s'écrasent pas.
    membership = await session.scalar(
        select(CampaignProspect).where(CampaignProspect.id == membership_id).with_for_update()
    )
    if membership is None:
        raise NotFoundError(f"Rattachement {membership_id} introuvable")

    attr = "interest_score" if score_type is ScoreType.INTEREST else "fit_score"
    before = getattr(membership, attr)
    after = clamp(before + points)
    if after == before:
        return membership, []

    old_total = membership.total_score
    setattr(membership, attr, after)
    membership.total_score = compute_total(membership.interest_score, membership.fit_score)
    membership.interest_status = level_for(membership.total_score)

    events = [
        ScoreEvent(
            prospect_id=membership.prospect_id,
            campaign_prospect_id=membership.id,
            score_type=score_type,
            points=after - before,
            new_value=after,
            reason=reason.strip(),
            actor_user_id=actor_user_id,
        )
    ]
    if membership.total_score != old_total:
        events.append(
            ScoreEvent(
                prospect_id=membership.prospect_id,
                campaign_prospect_id=membership.id,
                score_type=ScoreType.TOTAL,
                points=membership.total_score - old_total,
                new_value=membership.total_score,
                reason=reason.strip(),
                actor_user_id=actor_user_id,
            )
        )
    session.add_all(events)
    await session.commit()
    logger.info(
        "Score %s du rattachement %s : %s -> %s (total %s -> %s)",
        score_type.value, membership.id, before, after, old_total, membership.total_score,
    )  # fmt: skip
    return membership, events


async def apply_signal(
    session: AsyncSession,
    membership_id: int,
    signal: ScoringSignal,
    *,
    actor_user_id: int | None = None,
) -> tuple[CampaignProspect, list[ScoreEvent]]:
    score_type, points, reason = SIGNAL_RULES[signal]
    return await apply_score(
        session, membership_id, score_type, points, reason, actor_user_id=actor_user_id
    )
