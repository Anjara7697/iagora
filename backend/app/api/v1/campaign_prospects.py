from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import ANY_ROLE, CAN_WRITE, CurrentUser, DbSession
from app.models.enums import UserRole
from app.schemas.pipeline import (
    HistoryRead,
    MembershipUpdate,
    ScoreEventRead,
    ScoreRequest,
    ScoreResult,
)
from app.schemas.prospect import CampaignMembershipRead
from app.services import pipeline, scoring

router = APIRouter(prefix="/campaign-prospects", tags=["pipeline"], dependencies=[ANY_ROLE])


@router.get("/{membership_id}", response_model=CampaignMembershipRead)
async def get_membership(membership_id: int, session: DbSession) -> CampaignMembershipRead:
    """Rattachement d'un prospect à une campagne : étape, scores, conseiller."""
    return CampaignMembershipRead.model_validate(
        await pipeline.get_membership(session, membership_id)
    )


@router.patch("/{membership_id}", response_model=CampaignMembershipRead, dependencies=[CAN_WRITE])
async def update_membership(
    membership_id: int, payload: MembershipUpdate, session: DbSession, user: CurrentUser
) -> CampaignMembershipRead:
    """Change l'étape (avec justification, historisée) et/ou le conseiller affecté (ADMIN)."""
    if "assigned_advisor_id" in payload.model_fields_set and user.role is not UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Affectation réservée aux ADMIN")
    membership = await pipeline.update_membership(session, membership_id, payload, actor=user)
    return CampaignMembershipRead.model_validate(membership)


@router.post("/{membership_id}/scores", response_model=ScoreResult, dependencies=[CAN_WRITE])
async def add_score(
    membership_id: int, payload: ScoreRequest, session: DbSession, user: CurrentUser
) -> ScoreResult:
    """Applique un signal d'engagement ou un ajustement manuel justifié ; recalcule le total
    et le niveau d'intérêt."""
    if payload.signal is not None:
        membership, events = await scoring.apply_signal(
            session, membership_id, payload.signal, actor_user_id=user.id
        )
    else:
        assert payload.score_type and payload.points is not None and payload.reason  # noqa: S101
        membership, events = await scoring.apply_score(
            session, membership_id, payload.score_type, payload.points, payload.reason,
            actor_user_id=user.id,
        )  # fmt: skip
    return ScoreResult(
        membership=CampaignMembershipRead.model_validate(membership),
        events=[ScoreEventRead.model_validate(e) for e in events],
    )


@router.get("/{membership_id}/history", response_model=HistoryRead)
async def get_history(membership_id: int, session: DbSession) -> HistoryRead:
    """Historique justifié des changements d'étape et de score (OB-05)."""
    return await pipeline.get_history(session, membership_id)
