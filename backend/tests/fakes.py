"""Les doublures sont partagées avec les outils de développement (app/devtools/fakes.py)."""

from app.devtools.fakes import FakeCalendar, FakeKnowledge, FakeLLM, HashEmbeddings, make_slots

__all__ = ["FakeCalendar", "FakeKnowledge", "FakeLLM", "HashEmbeddings", "make_slots"]
