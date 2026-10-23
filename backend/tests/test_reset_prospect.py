"""`reset-prospect` : repartir de zéro pour UNE adresse de test, sans toucher au reste."""

import pytest
from app import agent_commands
from app.config import Settings
from app.models import Prospect
from app.services import demo
from sqlalchemy import select

from .test_demo import API, conversation_for, make


def _patch(monkeypatch, session_factory, mongo_db, **settings):
    monkeypatch.setattr(
        agent_commands, "get_settings", lambda: Settings(_env_file=None, **settings)
    )
    monkeypatch.setattr(agent_commands, "get_sessionmaker", lambda: session_factory)
    monkeypatch.setattr(agent_commands, "get_mongo_db", lambda: mongo_db)

    async def _noop():
        return None

    monkeypatch.setattr(agent_commands, "dispose_engine", _noop)


async def test_purge_prospect_removes_one_prospect_and_its_data_only(
    client, session_factory, mongo_db
):
    mine = await make(client, "moi@gmail.com", "Moi")
    other = await make(client, "autre@acme-corp.com", "Autre")
    await conversation_for(client, mine)
    await conversation_for(client, other)
    async with session_factory() as session:
        done = await demo.purge_prospect(session, mongo_db, "MOI@gmail.com")
    assert done == {"prospects": 1, "conversations": 1}
    left = (await client.get(f"{API}/prospects")).json()
    assert [p["first_name"] for p in left["items"]] == ["Autre"]
    assert await mongo_db["conversations"].count_documents({"prospect_id": other}) == 1
    async with session_factory() as session:
        again = await demo.purge_prospect(session, mongo_db, "moi@gmail.com")
    assert again == {"prospects": 0, "conversations": 0}


async def test_command_accepts_sandbox_and_demo_addresses(
    client, session_factory, mongo_db, monkeypatch, capsys
):
    _patch(monkeypatch, session_factory, mongo_db, email_sandbox_recipients="moi@gmail.com")
    await conversation_for(client, await make(client, "moi@gmail.com"))
    await conversation_for(client, await make(client, "sim.a@demo.example.com"))
    assert await agent_commands.cmd_reset_prospect("moi@gmail.com", unread=False) == 0
    assert await agent_commands.cmd_reset_prospect("sim.a@demo.example.com", unread=False) == 0
    assert "1 prospect(s)" in capsys.readouterr().out
    async with session_factory() as session:
        assert (await session.scalars(select(Prospect))).all() == []


@pytest.mark.parametrize("env", ["development", "production"])
async def test_command_refuses_real_prospects_and_production(
    client, session_factory, mongo_db, monkeypatch, capsys, env
):
    extra = (
        {
            "environment": "production",
            "jwt_secret_key": "x" * 40,
            "cors_origins": ["https://iagora.example.com"],
            "email_sandbox_recipients": "moi@gmail.com",
        }
        if env == "production"
        else {"environment": env}
    )
    _patch(monkeypatch, session_factory, mongo_db, **extra)
    await make(client, "moi@gmail.com")
    await make(client, "vrai@acme-corp.com")
    assert await agent_commands.cmd_reset_prospect("vrai@acme-corp.com", unread=False) == 1
    assert "Refusé" in capsys.readouterr().out
    if env == "production":
        assert await agent_commands.cmd_reset_prospect("moi@gmail.com", unread=False) == 1
    async with session_factory() as session:
        assert len((await session.scalars(select(Prospect))).all()) == 2
