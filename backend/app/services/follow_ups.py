"""Relances programmées (F-16). L'exécution des relances viendra avec le planificateur."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FollowUp
from app.models.enums import ConsentStatus
from app.services import references
from app.services.errors import ConflictError
from app.services.prospects import get_prospect

logger = logging.getLogger(__name__)


async def schedule_follow_up(
    session: AsyncSession,
    prospect_id: int,
    membership_id: int | None,
    channel_name: str | None,
    delay: timedelta,
    reason: str,
) -> FollowUp:
    prospect = await get_prospect(session, prospect_id)
    if prospect.consent_status is ConsentStatus.OPTED_OUT:
        raise ConflictError("Le prospect s'est désinscrit : aucune relance (S-03)")
    channel = await references.get_channel(session, channel_name)
    follow_up = FollowUp(
        prospect_id=prospect_id,
        campaign_prospect_id=membership_id,
        channel_id=channel.id if channel else None,
        scheduled_at=datetime.now(UTC) + delay,
        reason=reason,
    )
    session.add(follow_up)
    await session.commit()
    logger.info("Relance %s programmée dans %s : %s", follow_up.id, delay, reason)
    return follow_up
