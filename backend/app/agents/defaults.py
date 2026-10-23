"""Implémentations par défaut des ports qui n'ont pas encore de connecteur réel.

Elles ne simulent rien : l'agenda signale qu'il n'est pas configuré (le workflow transfère alors
au conseiller au lieu d'inventer une disponibilité, NF-10), et la base de connaissances est vide
(une question factuelle est donc transférée, jamais devinée). Les vrais connecteurs viendront
avec l'agenda (`app/integrations/calendar`) et le RAG.
"""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.graph.ports import (
    BookedMeeting,
    CalendarNotConfiguredError,
    MessageBlockedError,
    Passage,
    ProspectContext,
    Slot,
)
from app.models.enums import SenderType
from app.schemas.conversation import MessageCreate
from app.services import conversations
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError

NOT_CONFIGURED = "Agenda non configuré (CALENDAR_PROVIDER, voir docs/calendar.md)"


class UnconfiguredCalendar:
    async def get_available_slots(
        self, count: int, *, advisor_email: str | None = None
    ) -> list[Slot]:
        raise CalendarNotConfiguredError(
            "Agenda non configuré (CALENDAR_PROVIDER, voir docs/calendar.md)"
        )

    async def book(
        self,
        slot: Slot,
        prospect_name: str | None,
        *,
        advisor_email: str | None = None,
        prospect_email: str | None = None,
    ) -> BookedMeeting:
        raise CalendarNotConfiguredError(
            "Agenda non configuré (CALENDAR_PROVIDER, voir docs/calendar.md)"
        )


class EmptyKnowledgeBase:
    async def search(self, query: str, target_code: str | None, limit: int = 4) -> list[Passage]:
        return []


class RecordingMessenger:
    """Enregistre le message de l'agent dans la conversation (MongoDB) et le journal.

    Il ne l'envoie PAS encore sur le canal du prospect : la livraison (email IONOS, Meta,
    LinkedIn) viendra avec les connecteurs. Le message est marqué `delivery: not_sent`.

    En mode assisté, la réponse est un **brouillon** (`delivery: draft`, `draft.status: pending`)
    qu'un conseiller doit valider ; seul l'accusé de transfert (texte fixe, sans contenu
    commercial) est enregistré directement.
    """

    def __init__(self, session: AsyncSession, db: Any, mode: AgentMode = AgentMode.AUTO) -> None:
        self._session = session
        self._db = db
        self._mode = mode

    async def send(self, ctx: ProspectContext, text: str, metadata: dict[str, Any]) -> None:
        needs_validation = self._mode is AgentMode.ASSISTED and metadata.get("mode") != "handoff"
        extra: dict[str, Any] = (
            {"delivery": "draft", "draft": {"status": "pending"}}
            if needs_validation
            else {"delivery": "not_sent"}
        )
        data = MessageCreate(role=SenderType.AGENT, content=text, metadata={**metadata, **extra})
        try:
            await conversations.add_message(self._session, self._db, ctx.conversation_id, data)
        except ConflictError as exc:
            raise MessageBlockedError(exc.message) from exc
