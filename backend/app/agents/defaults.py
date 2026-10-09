"""Implémentations par défaut des ports qui n'ont pas encore de connecteur réel.

Elles ne simulent rien : l'agenda signale qu'il n'est pas configuré (le workflow transfère alors
au conseiller au lieu d'inventer une disponibilité, NF-10), et la base de connaissances est vide
(une question factuelle est donc transférée, jamais devinée). Les vrais connecteurs viendront
avec Google Calendar / Zoom et le RAG.
"""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.graph.ports import (
    BookedMeeting,
    CalendarError,
    MessageBlockedError,
    Passage,
    ProspectContext,
    Slot,
)
from app.models.enums import SenderType
from app.schemas.conversation import MessageCreate
from app.services import conversations
from app.services.errors import ConflictError


class UnconfiguredCalendar:
    async def get_available_slots(self, count: int) -> list[Slot]:
        raise CalendarError("Agenda non configuré (Google Calendar / Zoom à brancher)")

    async def book(self, slot: Slot, prospect_name: str | None) -> BookedMeeting:
        raise CalendarError("Agenda non configuré (Google Calendar / Zoom à brancher)")


class EmptyKnowledgeBase:
    async def search(self, query: str, target_code: str | None, limit: int = 4) -> list[Passage]:
        return []


class RecordingMessenger:
    """Enregistre le message de l'agent dans la conversation (MongoDB) et le journal.

    Il ne l'envoie PAS encore sur le canal du prospect : la livraison (email IONOS, Meta,
    LinkedIn) viendra avec les connecteurs. Le message est marqué `delivery: not_sent`.
    """

    def __init__(self, session: AsyncSession, db: Any) -> None:
        self._session = session
        self._db = db

    async def send(self, ctx: ProspectContext, text: str, metadata: dict[str, Any]) -> None:
        data = MessageCreate(
            role=SenderType.AGENT,
            content=text,
            metadata={**metadata, "delivery": "not_sent"},
        )
        try:
            await conversations.add_message(self._session, self._db, ctx.conversation_id, data)
        except ConflictError as exc:
            raise MessageBlockedError(exc.message) from exc
