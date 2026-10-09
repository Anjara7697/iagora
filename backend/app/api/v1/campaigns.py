from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.dependencies import ADMIN_ONLY, ANY_ROLE, DbSession
from app.models.enums import CampaignStatus
from app.schemas.campaign import CampaignCreate, CampaignRead, CampaignUpdate
from app.schemas.common import Page
from app.services import campaigns as service

router = APIRouter(prefix="/campaigns", tags=["campaigns"], dependencies=[ANY_ROLE])


@router.post(
    "", response_model=CampaignRead, status_code=status.HTTP_201_CREATED, dependencies=[ADMIN_ONLY]
)
async def create_campaign(payload: CampaignCreate, session: DbSession) -> CampaignRead:
    campaign = await service.create_campaign(session, payload)
    return await service.to_read(session, campaign)


@router.get("", response_model=Page[CampaignRead])
async def list_campaigns(
    session: DbSession,
    status_: Annotated[CampaignStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[CampaignRead]:
    rows, total = await service.list_campaigns(session, status_, limit, offset)
    return Page[CampaignRead](
        items=[await service.to_read(session, c) for c in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{campaign_id}", response_model=CampaignRead)
async def get_campaign(campaign_id: int, session: DbSession) -> CampaignRead:
    return await service.to_read(session, await service.get_campaign(session, campaign_id))


@router.patch("/{campaign_id}", response_model=CampaignRead, dependencies=[ADMIN_ONLY])
async def update_campaign(
    campaign_id: int, payload: CampaignUpdate, session: DbSession
) -> CampaignRead:
    campaign = await service.update_campaign(session, campaign_id, payload)
    return await service.to_read(session, campaign)
