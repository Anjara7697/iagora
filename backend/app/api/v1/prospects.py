from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.dependencies import ANY_ROLE, CAN_WRITE, DbSession
from app.models import Prospect
from app.schemas.common import Page
from app.schemas.interaction import InteractionCreate, InteractionRead
from app.schemas.prospect import (
    CampaignMembershipRead,
    ConsentRequest,
    OptOutRequest,
    ProspectDetail,
    ProspectIngest,
    ProspectIngestResult,
    ProspectRead,
    ProspectUpdate,
)
from app.services import interactions as interaction_service
from app.services import prospects as service

router = APIRouter(prefix="/prospects", tags=["prospects"], dependencies=[ANY_ROLE])


async def _detail(session: DbSession, prospect: Prospect) -> ProspectDetail:
    memberships = await service.get_memberships(session, prospect.id)
    return ProspectDetail.model_validate(prospect).model_copy(
        update={"campaigns": [CampaignMembershipRead.model_validate(m) for m in memberships]}
    )


@router.post(
    "",
    response_model=ProspectIngestResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def ingest_prospect(
    payload: ProspectIngest, session: DbSession, response: Response
) -> ProspectIngestResult:
    """Reçoit un prospect : déduplication, rattachement à la campagne, interaction d'entrée.
    201 si créé, 200 si un prospect existant a été reconnu."""
    prospect, created, interaction = await service.ingest_prospect(session, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return ProspectIngestResult(
        prospect=await _detail(session, prospect), created=created, interaction_id=interaction.id
    )


@router.get("", response_model=Page[ProspectRead])
async def list_prospects(
    session: DbSession,
    q: str | None = None,
    campaign_id: int | None = None,
    stage: str | None = None,
    advisor_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ProspectRead]:
    items, total = await service.list_prospects(
        session, q=q, campaign_id=campaign_id, stage=stage, advisor_id=advisor_id,
        limit=limit, offset=offset,
    )  # fmt: skip
    return Page[ProspectRead](
        items=[ProspectRead.model_validate(p) for p in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{prospect_id}", response_model=ProspectDetail)
async def get_prospect(prospect_id: int, session: DbSession) -> ProspectDetail:
    return await _detail(session, await service.get_prospect(session, prospect_id))


@router.patch("/{prospect_id}", response_model=ProspectDetail, dependencies=[CAN_WRITE])
async def update_prospect(
    prospect_id: int, payload: ProspectUpdate, session: DbSession
) -> ProspectDetail:
    return await _detail(session, await service.update_prospect(session, prospect_id, payload))


@router.post("/{prospect_id}/opt-out", response_model=ProspectDetail, dependencies=[CAN_WRITE])
async def opt_out(prospect_id: int, payload: OptOutRequest, session: DbSession) -> ProspectDetail:
    """Enregistre la désinscription : bloque les communications sortantes et annule les relances."""
    prospect = await service.opt_out(session, prospect_id, payload.source, payload.channel)
    return await _detail(session, prospect)


@router.post("/{prospect_id}/consent", response_model=ProspectDetail, dependencies=[CAN_WRITE])
async def grant_consent(
    prospect_id: int, payload: ConsentRequest, session: DbSession
) -> ProspectDetail:
    prospect = await service.grant_consent(session, prospect_id, payload.source, payload.channel)
    return await _detail(session, prospect)


@router.post(
    "/{prospect_id}/interactions",
    response_model=InteractionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def create_interaction(
    prospect_id: int, payload: InteractionCreate, session: DbSession, response: Response
) -> InteractionRead:
    interaction, created = await interaction_service.create_interaction(
        session, prospect_id, payload
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return InteractionRead.model_validate(interaction)


@router.get("/{prospect_id}/interactions", response_model=Page[InteractionRead])
async def list_interactions(
    prospect_id: int,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[InteractionRead]:
    rows, total = await interaction_service.list_interactions(session, prospect_id, limit, offset)
    return Page[InteractionRead](
        items=[InteractionRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
