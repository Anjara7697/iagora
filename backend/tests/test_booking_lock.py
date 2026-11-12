"""Réservation sérialisée par conseiller et créneau (AUDIT-AI-006)."""

import asyncio

import pytest
from app.config import Settings
from app.graph.ports import CalendarError
from app.services.agenda import ConsoleCalendar

from .fakes import FakeCalendar, make_slots


class SlowCalendar(FakeCalendar):
    def __init__(self) -> None:
        super().__init__()
        self.release = asyncio.Event()

    async def book(self, slot, prospect_name, **kwargs):
        await self.release.wait()
        return await super().book(slot, prospect_name, **kwargs)


async def test_two_prospects_cannot_book_the_same_slot_at_the_same_time(mongo_db, monkeypatch):
    calendar = SlowCalendar()
    console = ConsoleCalendar(Settings(_env_file=None), lambda: mongo_db)

    async def resolved(advisor_id):
        return calendar

    monkeypatch.setattr(console, "_resolve", resolved)
    slot = make_slots(1)[0]
    first = asyncio.create_task(console.book(slot, "Jean", advisor_id=7))
    await asyncio.sleep(0)  # la première réservation prend le verrou
    with pytest.raises(CalendarError, match="en cours de réservation"):
        await console.book(slot, "Marie", advisor_id=7)
    # Un autre conseiller, ou un autre créneau, n'est pas bloqué.
    calendar.release.set()
    await console.book(slot, "Paul", advisor_id=8)
    await first
    # Le verrou est rendu après la réservation.
    assert await console.book(slot, "Léa", advisor_id=7)
    assert await mongo_db["leases"].count_documents({"_id": {"$regex": "^booking:"}}) == 0
