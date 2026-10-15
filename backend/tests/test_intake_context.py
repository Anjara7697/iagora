"""Recette de l'entrée réelle jusqu'au contexte de scoring et à la reprise de traitement."""

import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest
from app.agents import auto
from app.agents.gateway import DbGateway
from app.api.dependencies import get_settings
from app.config import Settings
from app.main import app
from app.models import CampaignProspect, Interaction
from app.models.enums import UserRole
from app.services import agent_settings, conversations, drafts, intake, lease
from app.services.agent_settings import AgentMode
from sqlalchemy import select

from .fakes import FakeEmailClient
from .test_agent_workflow import env as env  # noqa: F401
from .test_email import mail, settings

API = "/api/v1"


@pytest.fixture
async def enabled(env):  # noqa: F811
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, agent_auto_reply=True)
    return env


async def campaign(client, name="Campagne"):
    r = await client.post(
        f"{API}/campaigns",
        json={
            "name": name,
            "status": "active",
            "target_codes": ["ebihar_students"],
            "sources": [{"name": "Formulaire", "platform": "web", "type": "form"}],
        },
    )
    assert r.status_code == 201
    c = r.json()
    return {"campaign_id": c["id"], "source_id": c["sources"][0]["id"]}


async def receive(client, **over):
    return await client.post(
        f"{API}/prospects",
        json={
            "email": "intake@example.com",
            "channel": "email",
            "message": "Bonjour",
            "external_id": "form-1",
            **over,
        },
    )


async def replies(client, pid):
    r = await client.get(f"{API}/prospects/{pid}/conversation")
    assert r.status_code == 200
    return [m for m in r.json()["messages"] if m["role"] == "agent"]


async def test_rest_entry_triggers_one_reply_and_keeps_one_canonical_message(client, enabled):
    link = await campaign(client)
    first = await receive(client, **link)
    assert first.status_code == 201
    pid = first.json()["prospect"]["id"]
    assert len(await replies(client, pid)) == 1
    again = await receive(client, **link)
    assert again.status_code == 200
    assert len(await replies(client, pid)) == 1
    doc = (await client.get(f"{API}/prospects/{pid}/conversation")).json()
    assert len([m for m in doc["messages"] if m["role"] == "prospect"]) == 1
    rows = (await client.get(f"{API}/prospects/{pid}/interactions")).json()["items"]
    entries = [r for r in rows if r["type"] == "lead_received"]
    assert (
        len(entries) == 1
        and entries[0]["content"] is None
        and entries[0]["conversation_ref"] == doc["id"]
    )


async def test_missing_campaign_is_queued_then_assignment_starts_processing(
    client, enabled, mongo_db
):
    r = await receive(client)
    pid = r.json()["prospect"]["id"]
    assert await replies(client, pid) == []
    assert (await client.get(f"{API}/prospects?pending_campaign=true")).json()["total"] == 1
    assert await mongo_db.agent_events.count_documents({"completed": False}) == 1
    link = await campaign(client)
    r = await client.post(f"{API}/prospects/{pid}/campaigns", json=link)
    assert r.status_code == 200 and len(r.json()["campaigns"]) == 1
    assert len(await replies(client, pid)) == 1
    await client.post(f"{API}/prospects/{pid}/campaigns", json=link)
    assert len(await replies(client, pid)) == 1
    assert (await client.get(f"{API}/prospects?pending_campaign=true")).json()["total"] == 0
    rows = (await client.get(f"{API}/prospects/{pid}/interactions")).json()["items"]
    assert len([r for r in rows if r["type"] == "campaign_attributed"]) == 1


async def test_unknown_email_waits_for_assignment(client, enabled, mongo_db, session_factory):
    from app.services import email_sync

    received = await email_sync.sync_inbound(
        session_factory, mongo_db, FakeEmailClient([mail()]), settings()
    )
    assert received.received == 1
    pid = (await client.get(f"{API}/prospects?pending_campaign=true")).json()["items"][0]["id"]
    cid = (await client.get(f"{API}/prospects/{pid}/conversation")).json()["id"]
    await auto.reply_to_message(
        cid,
        session_factory=session_factory,
        db=mongo_db,
        llm=enabled.llm,
        calendar=enabled.calendar,
        knowledge=enabled.kb,
    )
    assert await replies(client, pid) == []
    await client.post(f"{API}/prospects/{pid}/campaigns", json=await campaign(client))
    assert len(await replies(client, pid)) == 1


async def test_assignment_requires_write_rights_and_a_valid_active_source(client, make_client):
    pid = (await receive(client)).json()["prospect"]["id"]
    link = await campaign(client)
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.post(f"{API}/prospects/{pid}/campaigns", json=link)).status_code == 403
    assert (
        await client.post(f"{API}/prospects/{pid}/campaigns", json={**link, "source_id": 999})
    ).status_code == 422
    await client.patch(f"{API}/campaigns/{link['campaign_id']}", json={"status": "inactive"})
    assert (await client.post(f"{API}/prospects/{pid}/campaigns", json=link)).status_code == 422


async def test_recent_activity_context_matches_engine_inbox_and_prospect(
    client, env, session_factory, mongo_db
):  # noqa: F811
    one, two = await campaign(client, "Ancienne"), await campaign(client, "Nouvelle")
    pid = (await receive(client, **one)).json()["prospect"]["id"]
    await client.post(f"{API}/prospects/{pid}/campaigns", json=two)
    detail = (await client.get(f"{API}/prospects/{pid}")).json()
    old = detail["campaigns"][0]["id"]
    async with session_factory() as s:
        m = await s.get(CampaignProspect, old)
        m.last_seen_at = datetime.now(UTC) + timedelta(days=1)
        m.total_score = 65
        await s.commit()
    row = (await client.get(f"{API}/conversations")).json()["items"][0]
    async with session_factory() as s:
        ctx = await DbGateway(s, mongo_db).load_context(pid, row["id"])
    assert ctx.membership_id == row["prospect"]["membership_id"] == old
    assert ctx.campaign_name == row["prospect"]["campaign_name"] == "Ancienne"
    assert ctx.total_score == row["prospect"]["total_score"] == 65
    assert (await client.get(f"{API}/prospects/{pid}")).json()["current_membership_id"] == old


async def test_pending_event_can_be_retried_after_restart_without_new_reply(
    client, enabled, session_factory, mongo_db, monkeypatch
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    original = auto.reply_to_message

    async def lost_task(*args, **kwargs):
        pass

    monkeypatch.setattr(auto, "reply_to_message", lost_task)
    pid = (await receive(client, **await campaign(client))).json()["prospect"]["id"]
    event = await mongo_db.agent_events.find_one({"completed": False})
    assert event and await replies(client, pid) == []
    deps = {
        "session_factory": session_factory,
        "db": mongo_db,
        "llm": enabled.llm,
        "calendar": enabled.calendar,
        "knowledge": enabled.kb,
    }
    monkeypatch.setattr(auto, "reply_to_message", original)
    await auto.run_pending_replies(**deps)
    doc = (await client.get(f"{API}/prospects/{pid}/conversation")).json()
    message = next(m for m in doc["messages"] if m["role"] == "agent")
    # Un refus humain ne doit pas autoriser un doublon lors d'un rejeu de la source.
    await drafts.reject(mongo_db, doc["id"], message["id"], 1, "À revoir")
    await original(event["conversation_id"], **deps)
    assert len(await replies(client, pid)) == 1


async def test_shared_lock_excludes_another_process_and_is_released(mongo_db):
    async with lease.conversation_lock(mongo_db, "conversation"):
        assert not await lease.acquire(mongo_db, "agent:conversation", 90, holder="another-process")
    assert await lease.acquire(mongo_db, "agent:conversation", 90, holder="another-process")


async def test_partial_mongo_write_is_repaired_without_new_message(
    client, session_factory, mongo_db, monkeypatch
):
    original = conversations._ensure_journal

    async def fail(*args, **kwargs):
        raise RuntimeError("SQL indisponible")

    # Enregistrer d'abord l'entrée SQL sans routage.
    from app.schemas.prospect import ProspectIngest
    from app.services import prospects

    async with session_factory() as s:
        _, _, entry = await prospects.ingest_prospect(
            s, ProspectIngest(email="repair@example.com", channel="email", message="Bonjour")
        )
        monkeypatch.setattr(conversations, "_ensure_journal", fail)
        with pytest.raises(RuntimeError):
            await intake.route_entry(s, mongo_db, entry)
        monkeypatch.setattr(conversations, "_ensure_journal", original)
        cid = await intake.route_entry(s, mongo_db, entry)
        assert cid
        rows = list(await s.scalars(select(Interaction)))
        assert len(rows) == 1 and rows[0].conversation_ref == cid and rows[0].content is None
    doc = await conversations.get_doc(mongo_db, cid)
    assert len(doc["messages"]) == 1


async def test_replaying_an_old_source_does_not_change_the_current_context(client):
    first, second = await campaign(client, "Première"), await campaign(client, "Deuxième")
    pid = (await receive(client, **first)).json()["prospect"]["id"]
    await client.post(f"{API}/prospects/{pid}/campaigns", json=second)
    before = (await client.get(f"{API}/prospects/{pid}")).json()
    await receive(client, **first)
    after = (await client.get(f"{API}/prospects/{pid}")).json()
    assert after["current_membership_id"] == before["current_membership_id"]
    assert [m["last_seen_at"] for m in after["campaigns"]] == [
        m["last_seen_at"] for m in before["campaigns"]
    ]


async def test_no_channel_is_invented_for_an_incomplete_entry(client, enabled, mongo_db):
    r = await receive(client, channel=None, **await campaign(client))
    assert r.status_code == 201
    pid = r.json()["prospect"]["id"]
    assert (await client.get(f"{API}/prospects/{pid}/conversation")).status_code == 404
    assert await mongo_db.agent_events.count_documents({}) == 0
    history = (await client.get(f"{API}/prospects/{pid}/interactions")).json()["items"]
    assert history[0]["content"] == "Bonjour"  # conservé en attendant un canal déclaré


async def test_advisor_can_attribute_without_creating_a_campaign(client, make_client):
    pid = (await receive(client)).json()["prospect"]["id"]
    link = await campaign(client)
    advisor = await make_client(UserRole.ADVISOR)
    r = await advisor.post(f"{API}/prospects/{pid}/campaigns", json=link)
    assert r.status_code == 200 and len(r.json()["campaigns"]) == 1


async def test_an_external_identifier_cannot_route_another_prospects_message(client):
    await receive(client)
    r = await receive(client, email="someone-else@example.com")
    assert r.status_code == 409
    assert (await client.get(f"{API}/prospects")).json()["total"] == 1


async def test_an_orphan_event_does_not_block_the_worker(
    client, enabled, session_factory, mongo_db, monkeypatch
):
    original = auto.reply_to_message

    async def lost_task(*args, **kwargs):
        pass

    monkeypatch.setattr(auto, "reply_to_message", lost_task)
    await mongo_db.agent_events.insert_one(
        {
            "_id": "orphan",
            "conversation_id": "000000000000000000000000",
            "completed": False,
            "next_attempt_at": datetime.now(UTC) - timedelta(seconds=10),
        }
    )
    pid = (await receive(client, **await campaign(client))).json()["prospect"]["id"]
    monkeypatch.setattr(auto, "reply_to_message", original)
    await auto.run_pending_replies(
        session_factory=session_factory,
        db=mongo_db,
        llm=enabled.llm,
        calendar=enabled.calendar,
        knowledge=enabled.kb,
    )
    assert (await mongo_db.agent_events.find_one({"_id": "orphan"}))["cancelled"]
    assert len(await replies(client, pid)) == 1


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="concurrence PostgreSQL réelle (CI)"
)
async def test_concurrent_rest_replays_keep_one_entry_and_one_reply(client, enabled):
    link = await campaign(client)
    responses = await asyncio.gather(*(receive(client, **link) for _ in range(3)))
    assert sorted(r.status_code for r in responses) == [200, 200, 201]
    pid = responses[0].json()["prospect"]["id"]
    assert all(r.json()["prospect"]["id"] == pid for r in responses)
    assert len(await replies(client, pid)) == 1
    rows = (await client.get(f"{API}/prospects/{pid}/interactions")).json()["items"]
    assert len([r for r in rows if r["type"] == "lead_received"]) == 1


async def test_message_replay_repairs_a_failed_enqueue(client, env, monkeypatch):  # noqa: F811
    from app.services import agent_events

    pid = (await receive(client, message=None, **await campaign(client))).json()["prospect"]["id"]
    cid = (
        await client.post(f"{API}/conversations", json={"prospect_id": pid, "channel": "email"})
    ).json()["conversation"]["id"]
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, agent_auto_reply=True)
    original = agent_events.enqueue_reply
    attempts = 0

    async def fail_once(db, conversation_id):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("file temporairement indisponible")
        return await original(db, conversation_id)

    monkeypatch.setattr(agent_events, "enqueue_reply", fail_once)
    payload = {"role": "prospect", "content": "Bonjour", "external_message_id": "retry-enqueue"}
    with pytest.raises(RuntimeError):
        await client.post(f"{API}/conversations/{cid}/messages", json=payload)
    retry = await client.post(f"{API}/conversations/{cid}/messages", json=payload)
    assert retry.status_code == 200 and len(await replies(client, pid)) == 1
    await client.post(f"{API}/conversations/{cid}/messages", json=payload)
    assert len(await replies(client, pid)) == 1
