"""Campagnes, cibles et sources (F-01, F-02)."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Campaign,
    CampaignProspect,
    CampaignSource,
    CampaignTarget,
    Prospect,
    Source,
    Target,
)
from app.models.enums import CampaignStatus, ConversionStage, InterestLevel
from app.schemas.campaign import (
    CampaignCreate,
    CampaignOverview,
    CampaignRead,
    CampaignStats,
    CampaignUpdate,
    SourceCount,
    SourceInput,
    SourceRead,
    TargetRead,
)
from app.services import references
from app.services.demo import demo_filter
from app.services.errors import ConflictError, NotFoundError


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


async def _set_targets(session: AsyncSession, campaign_id: int, codes: list[str]) -> None:
    wanted = [await references.get_target(session, code) for code in dict.fromkeys(codes)]
    ids = {t.id for t in wanted if t is not None}
    current = list(
        await session.scalars(
            select(CampaignTarget).where(CampaignTarget.campaign_id == campaign_id)
        )
    )
    for link in current:
        if link.target_id not in ids:
            await session.delete(link)
    present = {link.target_id for link in current}
    for target_id in sorted(ids - present):
        session.add(CampaignTarget(campaign_id=campaign_id, target_id=target_id))


async def update_campaign(
    session: AsyncSession, campaign_id: int, data: CampaignUpdate
) -> Campaign:
    campaign = await get_campaign(session, campaign_id)
    changes = data.model_dump(exclude_unset=True)
    target_codes = changes.pop("target_codes", None)
    for field, value in changes.items():
        setattr(campaign, field, value)
    if target_codes is not None:
        await _set_targets(session, campaign_id, target_codes)
    await session.commit()
    return campaign


async def add_source(session: AsyncSession, campaign_id: int, data: SourceInput) -> Campaign:
    campaign = await get_campaign(session, campaign_id)
    source = await _get_or_create_source(session, data)
    already = await session.scalar(
        select(CampaignSource).where(
            CampaignSource.campaign_id == campaign_id, CampaignSource.source_id == source.id
        )
    )
    if already is not None:
        raise ConflictError("Cette source est déjà rattachée à la campagne")
    session.add(CampaignSource(campaign_id=campaign_id, source_id=source.id))
    await session.commit()
    return campaign


async def remove_source(session: AsyncSession, campaign_id: int, source_id: int) -> Campaign:
    """Détache une source. Refusé si des prospects en proviennent (l'historique est conservé)."""
    campaign = await get_campaign(session, campaign_id)
    link = await session.scalar(
        select(CampaignSource).where(
            CampaignSource.campaign_id == campaign_id, CampaignSource.source_id == source_id
        )
    )
    if link is None:
        raise NotFoundError("Source non rattachée à cette campagne")
    used = await session.scalar(
        select(func.count())
        .select_from(CampaignProspect)
        .where(CampaignProspect.campaign_source_id == link.id)
    )
    if used:
        raise ConflictError(
            f"{used} prospect(s) proviennent de cette source : elle ne peut pas être retirée"
        )
    await session.delete(link)
    await session.commit()
    return campaign


_MEETING_STAGES = {ConversionStage.MEETING_SCHEDULED, ConversionStage.MEETING_DONE}
_HOT = {InterestLevel.HOT, InterestLevel.VERY_HOT}


async def stats(session: AsyncSession, campaign_id: int) -> CampaignStats:
    await get_campaign(session, campaign_id)
    rows = await session.execute(
        select(
            CampaignProspect.conversion_stage,
            CampaignProspect.interest_status,
            CampaignProspect.total_score,
            CampaignSource.source_id,
        )
        .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
        .join(Prospect, Prospect.id == CampaignProspect.prospect_id)
        .where(CampaignSource.campaign_id == campaign_id, ~demo_filter())  # sans les fictifs
    )
    by_stage: dict[str, int] = {}
    by_level: dict[str, int] = {}
    per_source: dict[int, int] = {}
    scores: list[int] = []
    meetings = converted = 0
    for stage, level, score, source_id in rows:
        by_stage[stage.value] = by_stage.get(stage.value, 0) + 1
        key = level.value if level else "none"
        by_level[key] = by_level.get(key, 0) + 1
        per_source[source_id] = per_source.get(source_id, 0) + 1
        scores.append(score)
        meetings += stage in _MEETING_STAGES
        converted += stage is ConversionStage.CONVERTED
    sources = await session.scalars(
        select(Source)
        .join(CampaignSource, CampaignSource.source_id == Source.id)
        .where(CampaignSource.campaign_id == campaign_id)
        .order_by(Source.id)
    )
    return CampaignStats(
        prospects=len(scores),
        average_score=round(sum(scores) / len(scores), 1) if scores else 0.0,
        by_stage=by_stage,
        by_level=by_level,
        by_source=[
            SourceCount(
                source_id=s.id, name=s.name, platform=s.platform, prospects=per_source.get(s.id, 0)
            )
            for s in sources
        ],
        meetings=meetings,
        converted=converted,
    )


async def overview(session: AsyncSession) -> list[CampaignOverview]:
    """Chiffres clés de toutes les campagnes (une seule requête)."""
    rows = await session.execute(
        select(
            CampaignSource.campaign_id,
            CampaignProspect.conversion_stage,
            CampaignProspect.interest_status,
        )
        .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
        .join(Prospect, Prospect.id == CampaignProspect.prospect_id)
        .where(~demo_filter())  # les prospects fictifs ne faussent pas les chiffres
    )
    totals: dict[int, CampaignOverview] = {}
    for campaign_id, stage, level in rows:
        row = totals.setdefault(
            campaign_id,
            CampaignOverview(campaign_id=campaign_id, prospects=0, hot=0, meetings=0, converted=0),
        )
        row.prospects += 1
        row.hot += level in _HOT
        row.meetings += stage in _MEETING_STAGES
        row.converted += stage is ConversionStage.CONVERTED
    for campaign_id in await session.scalars(select(Campaign.id)):
        totals.setdefault(
            campaign_id,
            CampaignOverview(campaign_id=campaign_id, prospects=0, hot=0, meetings=0, converted=0),
        )
    return sorted(totals.values(), key=lambda o: o.campaign_id)


async def list_targets(session: AsyncSession) -> list[Target]:
    return list(await session.scalars(select(Target).order_by(Target.id)))
