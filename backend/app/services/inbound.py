"""Garde-fous appliqués à tout message du prospect, quel que soit le canal d'arrivée.

Ils ne dépendent ni du LLM ni de l'état de l'agent (mode manuel, conversation transférée, réponse
automatique désactivée) : un « STOP » est toujours honoré (S-03).
"""

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.graph import policy
from app.services import drafts
from app.services import prospects as prospect_service

logger = logging.getLogger(__name__)


async def on_prospect_message(
    session: AsyncSession,
    db: Any,
    *,
    conversation_id: str | None = None,
    prospect_id: int,
    channel: str | None,
    text: str,
    is_new: bool = True,
) -> bool:
    """Retourne True si le message est une demande d'arrêt (désinscription enregistrée)."""
    if policy.is_opt_out(text):
        await prospect_service.opt_out(session, prospect_id, "prospect_request", channel)
        await drafts.cancel_pending_for_prospect(db, prospect_id)
        await drafts.block_queued_for_prospect(db, prospect_id)
        logger.info("Désinscription enregistrée (prospect %s, canal %s)", prospect_id, channel)
        return True
    if is_new and conversation_id is not None:
        await drafts.supersede_pending(db, conversation_id, "Le prospect a écrit à nouveau")
    return False
