"""Garde-fous transverses issus de la revue : STOP, messages, brouillons, droits."""

import asyncio

import pytest
from app.models.enums import UserRole
from app.services import agent_settings
from app.services.agent_settings import AgentMode

from .test_agent_workflow import conversation, lead, run, say
from .test_agent_workflow import env as env  # noqa: F401  (fixture)

API = "/api/v1"


@pytest.fixture
async def assisted(env, mongo_db):  # noqa: F811
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    return env


async def agent_messages(client, cid):
    return [m for m in (await conversation(client, cid))["messages"] if m["role"] == "agent"]


async def consent(client, pid):
    return (await client.get(f"{API}/prospects/{pid}")).json()["consent_status"]


async def test_stop_is_honoured_even_when_the_agent_is_stopped(client, env, mongo_db):  # noqa: F811
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)  # arrêt d'urgence
    pid, mid, cid = await lead(client, text=None)
    await say(client, cid, "STOP, ne m'écrivez plus.")
    assert await consent(client, pid) == "opted_out"


async def test_stop_is_honoured_in_a_handed_off_conversation(client, env):  # noqa: F811
    pid, mid, cid = await lead(client, text=None)
    await client.patch(f"{API}/conversations/{cid}", json={"status": "handed_off"})
    await say(client, cid, "Arrêtez de m'écrire, désinscrivez-moi. STOP")
    assert await consent(client, pid) == "opted_out"


async def test_a_new_prospect_message_replaces_the_pending_draft(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    await say(client, cid, "J'ai oublié : j'ai aussi une question sur le financement.")
    statuses = [m["metadata"]["draft"]["status"] for m in await agent_messages(client, cid)]
    assert statuses == ["superseded"]  # un seul brouillon validable à la fois


async def test_reserved_metadata_cannot_be_set_through_the_api(client, env):  # noqa: F811
    pid, mid, cid = await lead(client, text=None)
    r = await client.post(
        f"{API}/conversations/{cid}/messages",
        json={
            "role": "agent",
            "content": "Je contourne la validation",
            "metadata": {"delivery": "not_sent", "draft": {"status": "approved"}, "intent": "x"},
        },
    )
    meta = r.json()["message"]["metadata"]
    assert "delivery" not in meta and "draft" not in meta and meta["intent"] == "x"


async def test_advisor_messages_record_their_author_and_cannot_forge_delivery(client, env):  # noqa: F811
    pid, mid, cid = await lead(client, text=None)
    r = await client.post(
        f"{API}/conversations/{cid}/messages",
        json={"role": "advisor", "content": "Bonjour", "metadata": {"delivery": "sent"}},
    )
    meta = r.json()["message"]["metadata"]
    assert meta["delivery"] == "not_sent" and isinstance(meta["author_id"], int)


async def test_a_draft_cannot_be_approved_in_a_closed_conversation(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = (await agent_messages(client, cid))[0]
    await client.patch(f"{API}/conversations/{cid}", json={"status": "closed"})
    # la clôture a annulé le brouillon : il ne peut plus être validé
    assert (await agent_messages(client, cid))[0]["metadata"]["draft"]["status"] == "cancelled"
    r = await client.post(f"{API}/conversations/{cid}/drafts/{draft['id']}/approve", json={})
    assert r.status_code == 409


async def test_two_simultaneous_decisions_on_a_draft_give_one_winner(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = (await agent_messages(client, cid))[0]
    base = f"{API}/conversations/{cid}/drafts/{draft['id']}"
    a, b = await asyncio.gather(
        client.post(f"{base}/approve", json={}),
        client.post(f"{base}/reject", json={"reason": "non"}),
    )
    assert sorted([a.status_code, b.status_code]) == [200, 409]


async def test_only_an_admin_can_lift_an_opt_out(client, make_client, env):  # noqa: F811
    pid, mid, cid = await lead(client, text=None)
    await client.post(f"{API}/prospects/{pid}/opt-out", json={"source": "test"})
    advisor = await make_client(UserRole.ADVISOR)
    body = {"source": "appel téléphonique"}
    assert (await advisor.post(f"{API}/prospects/{pid}/consent", json=body)).status_code == 403
    assert (await client.post(f"{API}/prospects/{pid}/consent", json=body)).status_code == 200
