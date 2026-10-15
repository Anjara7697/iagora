"""Historique des interactions (F-06, OB-05)."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Interaction
from app.models.enums import ConsentStatus, Direction
from app.schemas.interaction import InteractionCreate
from app.services import follow_ups, references
from app.services.errors import ConflictError
from app.services.prospects import get_prospect


async def create_interaction(
    session: AsyncSession, prospect_id: int, data: InteractionCreate
) -> tuple[Interaction, bool]:
    """Enregistre une interaction. Retourne (interaction, créée) : un rejeu avec le même
    (canal, identifiant externe) renvoie l'existante (NF-05)."""
    prospect = await get_prospect(session, prospect_id)
    channel = await references.get_channel(session, data.channel)
    channel_id = channel.id if channel else None

    if data.direction is Direction.OUTBOUND and prospect.consent_status is ConsentStatus.OPTED_OUT:
        raise ConflictError("Le prospect s'est désinscrit : aucune communication sortante (S-03)")

    if channel_id and data.external_id:
        existing = await session.scalar(
            select(Interaction).where(
                Interaction.channel_id == channel_id, Interaction.external_id == data.external_id
            )
        )
        if existing:
            return existing, False

    interaction = Interaction(
        prospect_id=prospect_id,
        channel_id=channel_id,
        type=data.type,
        direction=data.direction,
        content=data.content,
        external_id=data.external_id,
        intent=data.intent,
        sentiment=data.sentiment,
    )
    session.add(interaction)
    if channel_id and data.direction is Direction.INBOUND:
        prospect.current_channel_id = channel_id
    await session.commit()
    if data.direction is Direction.INBOUND:
        await follow_ups.cancel_pending(session, prospect_id)
    return interaction, True


async def list_interactions(
    session: AsyncSession, prospect_id: int, limit: int, offset: int
) -> tuple[list[Interaction], int]:
    await get_prospect(session, prospect_id)
    base = select(Interaction).where(Interaction.prospect_id == prospect_id)
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = await session.scalars(
        base.order_by(Interaction.created_at.desc(), Interaction.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total
