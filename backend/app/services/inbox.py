"""Boîte de réception unifiée : conversations (MongoDB) enrichies du prospect (PostgreSQL)."""

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampaignProspect, Prospect
from app.models.enums import ConversationStatus
from app.schemas.conversation import ConversationProspect, ConversationSummary
from app.services import commercial_context, conversations, scoring
from app.services.prospects import campaign_labels


async def _matching_prospect_ids(
    session: AsyncSession, q: str | None, advisor_id: int | None, unassigned: bool
) -> list[int] | None:
    """Prospects correspondant à la recherche et à l'affectation ; None si aucun filtre."""
    if not q and advisor_id is None and not unassigned:
        return None
    stmt = select(Prospect.id)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(func.coalesce(Prospect.first_name, "")).like(like),
                func.lower(func.coalesce(Prospect.last_name, "")).like(like),
                func.lower(func.coalesce(Prospect.email, "")).like(like),
            )
        )
    if advisor_id is not None:
        stmt = stmt.where(
            Prospect.id.in_(
                select(CampaignProspect.prospect_id).where(
                    CampaignProspect.id.in_(commercial_context.latest_ids()),
                    CampaignProspect.assigned_advisor_id == advisor_id,
                )
            )
        )
    elif unassigned:
        stmt = stmt.where(
            ~Prospect.id.in_(
                select(CampaignProspect.prospect_id).where(
                    CampaignProspect.id.in_(commercial_context.latest_ids()),
                    CampaignProspect.assigned_advisor_id.is_not(None),
                )
            )
        )
    return list(await session.scalars(stmt))


async def prospect_cards(
    session: AsyncSession, prospect_ids: list[int]
) -> dict[int, ConversationProspect]:
    """Nom, étape et score de chaque prospect (rattachement le plus récent), en deux requêtes."""
    ids = list(set(prospect_ids))
    if not ids:
        return {}
    prospects = {
        p.id: p for p in await session.scalars(select(Prospect).where(Prospect.id.in_(ids)))
    }
    best = await commercial_context.memberships(session, ids)
    labels = await campaign_labels(session, [m.campaign_source_id for m in best.values()])
    names = await commercial_context.source_names(
        session, [m.campaign_source_id for m in best.values()]
    )
    cards: dict[int, ConversationProspect] = {}
    for pid, p in prospects.items():
        card: dict[str, Any] = {
            "id": p.id,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "email": p.email,
        }
        membership = best.get(pid)
        if membership is not None:
            card |= {
                "membership_id": membership.id,
                "campaign_id": labels.get(membership.campaign_source_id, (None, ""))[0],
                "campaign_name": labels.get(membership.campaign_source_id, (None, ""))[1],
                "campaign_source_id": membership.campaign_source_id,
                "source_name": names.get(membership.campaign_source_id),
                "stage": membership.conversion_stage.value,
                "total_score": membership.total_score,
                "level": scoring.level_for(membership.total_score).value,
                "assigned_advisor_id": membership.assigned_advisor_id,
            }
        cards[pid] = ConversationProspect(**card)
    return cards


async def _attach_prospects(
    session: AsyncSession, items: list[ConversationSummary]
) -> list[ConversationSummary]:
    cards = await prospect_cards(session, [c.prospect_id for c in items])
    return [c.model_copy(update={"prospect": cards.get(c.prospect_id)}) for c in items]


async def list_inbox(
    session: AsyncSession,
    db: Any,
    *,
    status: ConversationStatus | None,
    channel: str | None,
    q: str | None,
    advisor_id: int | None,
    unassigned: bool,
    limit: int,
    offset: int,
) -> tuple[list[ConversationSummary], int]:
    ids = await _matching_prospect_ids(session, q, advisor_id, unassigned)
    items, total = await conversations.list_conversations(
        db, status, limit, offset, channel=channel, prospect_ids=ids
    )
    return await _attach_prospects(session, items), total
