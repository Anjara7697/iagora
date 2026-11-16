"""Durées de conservation des traces de l'agent (AUDIT-DATA-003, décision D-18)."""

import os
from datetime import UTC, datetime

import pytest
from app.config import Settings
from app.services import retention


def _settings(**values: object) -> Settings:
    return Settings(environment="development", **values)  # type: ignore[arg-type]


async def test_agent_traces_and_finished_queue_entries_expire(mongo_db):
    await mongo_db["agent_events"].insert_many(
        [
            {"_id": "fini-avant", "completed": True},  # terminé avant cette version
            {"_id": "en-cours", "completed": False},
        ]
    )
    await retention.ensure_retention(mongo_db, _settings())
    await retention.ensure_retention(mongo_db, _settings())  # rejouable au démarrage

    runs = (await mongo_db["agent_runs"].index_information())["started_at_ttl"]
    assert runs["expireAfterSeconds"] == 365 * retention.DAY
    events = (await mongo_db["agent_events"].index_information())["completed_at_ttl"]
    assert events["expireAfterSeconds"] == 30 * retention.DAY
    assert events.get("partialFilterExpression") == {"completed": True}

    finished = await mongo_db["agent_events"].find_one({"_id": "fini-avant"})
    assert isinstance(finished["completed_at"], datetime)
    assert finished["completed_at"] <= datetime.now(UTC)
    pending = await mongo_db["agent_events"].find_one({"_id": "en-cours"})
    assert "completed_at" not in pending  # une entrée à traiter n'expire jamais


@pytest.mark.skipif(not os.getenv("TEST_MONGO_URI"), reason="collMod : MongoDB réel (CI)")
async def test_a_new_retention_period_is_applied_without_recreating_the_index(mongo_db):
    await retention.ensure_retention(mongo_db, _settings())
    await retention.ensure_retention(mongo_db, _settings(agent_runs_retention_days=180))
    runs = (await mongo_db["agent_runs"].index_information())["started_at_ttl"]
    assert runs["expireAfterSeconds"] == 180 * retention.DAY


def test_retention_periods_are_bounded():
    with pytest.raises(ValueError):
        _settings(agent_runs_retention_days=5)
