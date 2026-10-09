"""Doublures des ports du workflow : aucun appel réseau, comportement scénarisé.

Utilisées par les tests automatiques et par la recette hors ligne
(`python -m app.cli scenario --fake`)."""

from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from app.graph.ports import (
    BookedMeeting,
    CalendarError,
    ChatMessage,
    Passage,
    Slot,
    T,
)
from app.graph.state import Qualification


class FakeLLM:
    """Modèle de langage scénarisé. `qualification` et `reply` peuvent être une valeur, une
    exception à lever, ou une fonction (système, messages) -> valeur."""

    provider = "fake"
    model = "fake-1"

    def __init__(
        self,
        qualification: Qualification | Exception | Callable[..., Any] | None = None,
        reply: str | Exception | Callable[..., Any] = "Bonjour, merci pour votre message.",
    ) -> None:
        self.qualification = qualification or Qualification(intent="other")
        self.reply = reply
        self.extract_calls: list[tuple[str, list[ChatMessage]]] = []
        self.generate_calls: list[tuple[str, list[ChatMessage]]] = []

    @staticmethod
    def _resolve(value: Any, system: str, messages: Sequence[ChatMessage]) -> Any:
        if callable(value) and not isinstance(value, type):
            value = value(system, messages)
        if isinstance(value, Exception):
            raise value
        return value

    async def extract(self, system: str, messages: Sequence[ChatMessage], schema: type[T]) -> T:
        self.extract_calls.append((system, list(messages)))
        return self._resolve(self.qualification, system, messages)  # type: ignore[no-any-return]

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        self.generate_calls.append((system, list(messages)))
        return str(self._resolve(self.reply, system, messages))

    @property
    def all_prompts(self) -> str:
        calls = self.extract_calls + self.generate_calls
        return "\n".join(s + "\n".join(m.content for m in msgs) for s, msgs in calls)


def make_slots(count: int = 3) -> list[Slot]:
    # Un lundi à 14h (heure de Paris), puis des jours suivants.
    base = datetime(2027, 3, 1, 13, 0, tzinfo=UTC)
    return [
        Slot(id=f"slot-{i}", start=base + timedelta(days=i), end=base + timedelta(days=i, hours=1))
        for i in range(count)
    ]


class FakeCalendar:
    def __init__(self, slots: list[Slot] | None = None, fail_booking: bool = False) -> None:
        self.slots = make_slots() if slots is None else slots
        self.fail_booking = fail_booking
        self.booked: list[Slot] = []

    async def get_available_slots(self, count: int) -> list[Slot]:
        return self.slots[:count]

    async def book(self, slot: Slot, prospect_name: str | None) -> BookedMeeting:
        if self.fail_booking:
            raise CalendarError("créneau pris entre-temps")
        self.booked.append(slot)
        return BookedMeeting(
            calendar_event_id=f"evt-{slot.id}",
            meeting_url=f"https://zoom.example/{slot.id}",
            zoom_meeting_id=f"zoom-{slot.id}",
            slot=slot,
        )


class FakeKnowledge:
    def __init__(self, passages: list[Passage] | None = None) -> None:
        self.passages = passages or []
        self.queries: list[str] = []

    async def search(self, query: str, target_code: str | None, limit: int = 4) -> list[Passage]:
        self.queries.append(query)
        return self.passages[:limit]
