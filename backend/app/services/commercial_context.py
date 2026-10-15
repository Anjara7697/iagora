"""Contexte commercial commun au moteur, à la boîte de réception et aux filtres.

L'activité la plus récente l'emporte ; l'identifiant départage les égalités.
Les scores restent portés par le rattachement à une source, sans fusion implicite.
"""

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Campaign, CampaignProspect, CampaignSource, Source
from app.models.enums import CampaignStatus


def latest_ids() -> Select[tuple[int]]:
    ranked = select(
        CampaignProspect.id,
        func.row_number()
        .over(
            partition_by=CampaignProspect.prospect_id,
            order_by=(CampaignProspect.last_seen_at.desc(), CampaignProspect.id.desc()),
        )
        .label("rank"),
    ).subquery()
    return select(ranked.c.id).where(ranked.c.rank == 1)


async def memberships(
    session: AsyncSession, prospect_ids: list[int]
) -> dict[int, CampaignProspect]:
    if not prospect_ids:
        return {}
    rows = await session.scalars(
        select(CampaignProspect).where(
            CampaignProspect.prospect_id.in_(prospect_ids),
            CampaignProspect.id.in_(latest_ids()),
        )
    )
    return {m.prospect_id: m for m in rows}


async def source_names(session: AsyncSession, ids: list[int]) -> dict[int, str]:
    rows = await session.execute(
        select(CampaignSource.id, Source.name)
        .join(Source, Source.id == CampaignSource.source_id)
        .where(CampaignSource.id.in_(ids))
    )
    return {row[0]: row[1] for row in rows}


async def is_active(session: AsyncSession, membership: CampaignProspect) -> bool:
    value = await session.scalar(
        select(Campaign.id)
        .join(CampaignSource, CampaignSource.campaign_id == Campaign.id)
        .join(Source, Source.id == CampaignSource.source_id)
        .where(
            CampaignSource.id == membership.campaign_source_id,
            Campaign.status == CampaignStatus.ACTIVE,
            CampaignSource.status == "active",
            Source.is_active.is_(True),
        )
    )
    return value is not None
