"""Campagnes, cibles et sources (F-01, F-02)."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Campaign, CampaignSource, CampaignTarget, Source, Target
from app.models.enums import CampaignStatus
from app.schemas.campaign import (
    CampaignCreate,
    CampaignRead,
    CampaignUpdate,
    SourceInput,
    SourceRead,
    TargetRead,
)
from app.services import references
from app.services.errors import NotFoundError


async def _get_or_create_source(session: AsyncSession, data: SourceInput) -> Source:
    if data.external_id:
        existing = await session.scalar(
            select(Source).where(
                Source.platform == data.platform, Source.external_id == data.external_id
            )
        )
        if existing:
            return existing
    source = Source(
        name=data.name, type=data.type, platform=data.platform, external_id=data.external_id
    )
    session.add(source)
    await session.flush()
    return source


async def to_read(session: AsyncSession, campaign: Campaign) -> CampaignRead:
    targets = await session.scalars(
        select(Target)
        .join(CampaignTarget, CampaignTarget.target_id == Target.id)
        .where(CampaignTarget.campaign_id == campaign.id)
        .order_by(Target.id)
    )
    sources = await session.scalars(
        select(Source)
        .join(CampaignSource, CampaignSource.source_id == Source.id)
        .where(CampaignSource.campaign_id == campaign.id)
        .order_by(Source.id)
    )
    return CampaignRead.model_validate(campaign).model_copy(
        update={
            "targets": [TargetRead.model_validate(t) for t in targets],
            "sources": [SourceRead.model_validate(s) for s in sources],
        }
    )


async def create_campaign(session: AsyncSession, data: CampaignCreate) -> Campaign:
    codes = dict.fromkeys(data.target_codes)
    targets = [await references.get_target(session, code) for code in codes]
    campaign = Campaign(
        name=data.name,
        description=data.description,
        status=data.status,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    session.add(campaign)
    await session.flush()
    for target in targets:
        assert target is not None  # noqa: S101 - get_target lève si inconnu
        session.add(CampaignTarget(campaign_id=campaign.id, target_id=target.id))
    for source_input in data.sources:
        source = await _get_or_create_source(session, source_input)
        session.add(CampaignSource(campaign_id=campaign.id, source_id=source.id))
    await session.commit()
    return campaign


async def get_campaign(session: AsyncSession, campaign_id: int) -> Campaign:
    campaign = await session.get(Campaign, campaign_id)
    if campaign is None:
        raise NotFoundError(f"Campagne {campaign_id} introuvable")
    return campaign


async def list_campaigns(
    session: AsyncSession, status: CampaignStatus | None, limit: int, offset: int
) -> tuple[list[Campaign], int]:
    stmt = select(Campaign)
    if status is not None:
        stmt = stmt.where(Campaign.status == status)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await session.scalars(stmt.order_by(Campaign.id.desc()).limit(limit).offset(offset))
    return list(rows), total


async def update_campaign(
    session: AsyncSession, campaign_id: int, data: CampaignUpdate
) -> Campaign:
    campaign = await get_campaign(session, campaign_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(campaign, field, value)
    await session.commit()
    return campaign
