import asyncio
import os

import pytest
from app.models import Interaction, Prospect
from app.models.enums import SenderType, UserRole
from app.schemas.conversation import MessageCreate
from app.services import conversations as service
from sqlalchemy import delete, select

API = "/api/v1"


async def _prospect(client, email="jean@example.com", **over):
    r = await client.post(f"{API}/prospects", json={"email": email, "channel": "email"} | over)
    return r.json()["prospect"]["id"]


async def _open(client, pid, channel="email", **over):
    return await client.post(
        f"{API}/conversations", json={"prospect_id": pid, "channel": channel} | over
    )


def _msg(role="prospect", content="Bonjour", **over):
    return {"role": role, "content": content} | over


async def test_open_conversation_is_reused_per_prospect_and_channel(client):
    pid = await _prospect(client)
    first = await _open(client, pid)
    assert first.status_code == 201
    assert first.json()["created"] is True
    conv = first.json()["conversation"]
    assert conv["status"] == "open" and conv["messages"] == []

    again = await _open(client, pid)
    assert again.status_code == 200
    assert again.json()["created"] is False
    assert again.json()["conversation"]["id"] == conv["id"]

    other = await _open(client, pid, channel="facebook")  # autre canal : autre conversation
    assert other.status_code == 201 and other.json()["conversation"]["id"] != conv["id"]


async def test_create_with_first_message_and_journal(client, session_factory):
    pid = await _prospect(client)
    r = await _open(
        client, pid, message=_msg(content="Je suis intéressé", metadata={"intent": "info"})
    )
    conv = r.json()["conversation"]
    assert [m["content"] for m in conv["messages"]] == ["Je suis intéressé"]
    assert conv["last_message_at"] is not None
    assert conv["messages"][0]["metadata"] == {"intent": "info"}

    async with session_factory() as s:
        rows = (await s.scalars(select(Interaction).where(Interaction.type == "message"))).all()
    assert len(rows) == 1
    journal = rows[0]
    assert journal.conversation_ref == conv["id"]
    assert journal.content is None  # le contenu n'est stocké que dans MongoDB
    assert journal.direction.value == "inbound" and journal.intent == "info"


async def test_add_messages_in_order_with_roles(client):
    pid = await _prospect(client)
    cid = (await _open(client, pid)).json()["conversation"]["id"]
    turns = [
        ("prospect", "Bonjour"),
        ("agent", "Bonjour, comment puis-je aider ?"),
        ("prospect", "Quelles sont les dates ?"),
        ("advisor", "Je reprends."),
    ]
    for role, text in turns:
        r = await client.post(f"{API}/conversations/{cid}/messages", json=_msg(role, text))
        assert r.status_code == 201 and r.json()["created"] is True
    conv = (await client.get(f"{API}/conversations/{cid}")).json()
    assert [m["role"] for m in conv["messages"]] == ["prospect", "agent", "prospect", "advisor"]
    assert conv["messages"][1]["created_at"] <= conv["messages"][2]["created_at"]


async def test_replayed_message_creates_no_duplicate(client, session_factory):
    pid = await _prospect(client)
    cid = (await _open(client, pid)).json()["conversation"]["id"]
    body = _msg(external_message_id="ext-1")
    first = await client.post(f"{API}/conversations/{cid}/messages", json=body)
    replay = await client.post(f"{API}/conversations/{cid}/messages", json=body)
    assert first.status_code == 201 and replay.status_code == 200
    assert replay.json()["created"] is False
    assert replay.json()["message"]["id"] == first.json()["message"]["id"]
    assert len((await client.get(f"{API}/conversations/{cid}")).json()["messages"]) == 1
    async with session_factory() as s:
        count = len(
            (await s.scalars(select(Interaction).where(Interaction.type == "message"))).all()
        )
    assert count == 1  # NF-05


async def test_replay_repairs_missing_journal(client, session_factory):
    """Si l'écriture PostgreSQL a échoué après MongoDB, un rejeu répare le journal."""
    pid = await _prospect(client)
    cid = (await _open(client, pid)).json()["conversation"]["id"]
    body = _msg(external_message_id="ext-9")
    await client.post(f"{API}/conversations/{cid}/messages", json=body)
    async with session_factory() as s:
        await s.execute(delete(Interaction).where(Interaction.type == "message"))
        await s.commit()
    replay = await client.post(f"{API}/conversations/{cid}/messages", json=body)
    assert replay.status_code == 200
    async with session_factory() as s:
        assert (
            len((await s.scalars(select(Interaction).where(Interaction.type == "message"))).all())
            == 1
        )
    assert len((await client.get(f"{API}/conversations/{cid}")).json()["messages"]) == 1


async def test_inbound_message_updates_current_channel(client, session_factory):
    pid = await _prospect(client)
    cid = (await _open(client, pid, channel="facebook")).json()["conversation"]["id"]
    await client.post(f"{API}/conversations/{cid}/messages", json=_msg())
    async with session_factory() as s:
        prospect = await s.get(Prospect, pid)
        assert prospect.current_channel_id != prospect.origin_channel_id  # F-07


async def test_opt_out_blocks_outbound_messages_only(client):
    pid = await _prospect(client)
    cid = (await _open(client, pid)).json()["conversation"]["id"]
    await client.post(f"{API}/prospects/{pid}/opt-out", json={})
    for role in ("agent", "advisor"):
        r = await client.post(f"{API}/conversations/{cid}/messages", json=_msg(role))
        assert r.status_code == 409  # S-03
    ok = await client.post(f"{API}/conversations/{cid}/messages", json=_msg("prospect", "STOP"))
    assert ok.status_code == 201  # le prospect peut toujours écrire


async def test_status_transitions_and_summary(client):
    pid = await _prospect(client)
    cid = (await _open(client, pid)).json()["conversation"]["id"]
    url = f"{API}/conversations/{cid}"
    r = await client.patch(url, json={"status": "handed_off", "summary": "Veut un rendez-vous"})
    assert r.json()["status"] == "handed_off" and r.json()["summary"] == "Veut un rendez-vous"
    assert (
        await client.post(f"{url}/messages", json=_msg("advisor", "Je vous appelle"))
    ).status_code == 201
    assert (await client.patch(url, json={"status": "open"})).json()["status"] == "open"
    closed = (await client.patch(url, json={"status": "closed"})).json()
    assert closed["closed_at"] is not None
    assert (await client.patch(url, json={"status": "open"})).status_code == 409
    assert (await client.post(f"{url}/messages", json=_msg())).status_code == 409
    # une nouvelle conversation peut être ouverte une fois l'ancienne clôturée
    again = await _open(client, pid)
    assert again.status_code == 201 and again.json()["conversation"]["id"] != cid


async def test_latest_conversation_of_prospect(client):
    pid = await _prospect(client)
    assert (await client.get(f"{API}/prospects/{pid}/conversation")).status_code == 404
    email = (await _open(client, pid, channel="email")).json()["conversation"]["id"]
    fb = (await _open(client, pid, channel="facebook")).json()["conversation"]["id"]
    await client.post(f"{API}/conversations/{email}/messages", json=_msg())
    latest = (await client.get(f"{API}/prospects/{pid}/conversation")).json()
    assert latest["id"] == email  # dernier message le plus récent
    await client.post(f"{API}/conversations/{fb}/messages", json=_msg())
    assert (await client.get(f"{API}/prospects/{pid}/conversation")).json()["id"] == fb
    only_email = await client.get(
        f"{API}/prospects/{pid}/conversation", params={"channel": "email"}
    )
    assert only_email.json()["id"] == email
    assert (await client.get(f"{API}/prospects/999/conversation")).status_code == 404


async def test_validation_and_not_found(client):
    pid = await _prospect(client)
    assert (await _open(client, 999)).status_code == 404
    assert (await _open(client, pid, channel="telegram")).status_code == 422
    assert (await client.get(f"{API}/conversations/not-an-object-id")).status_code == 404
    assert (await client.get(f"{API}/conversations/{'0' * 24}")).status_code == 404
    cid = (await _open(client, pid)).json()["conversation"]["id"]
    assert (
        await client.post(f"{API}/conversations/{cid}/messages", json=_msg(content=""))
    ).status_code == 422
    assert (
        await client.post(f"{API}/conversations/{cid}/messages", json=_msg("robot"))
    ).status_code == 422
    assert (
        await client.post(f"{API}/conversations/{'0' * 24}/messages", json=_msg())
    ).status_code == 404


async def test_roles_on_conversations(make_client):
    admin = await make_client(UserRole.ADMIN)
    viewer = await make_client(UserRole.VIEWER)
    advisor = await make_client(UserRole.ADVISOR)
    anon = await make_client(None)
    pid = await _prospect(admin)
    cid = (await _open(advisor, pid)).json()["conversation"]["id"]
    assert (await viewer.get(f"{API}/conversations/{cid}")).status_code == 200
    assert (await viewer.get(f"{API}/prospects/{pid}/conversation")).status_code == 200
    assert (
        await viewer.post(f"{API}/conversations/{cid}/messages", json=_msg())
    ).status_code == 403
    assert (
        await viewer.patch(f"{API}/conversations/{cid}", json={"status": "closed"})
    ).status_code == 403
    assert (await _open(viewer, pid, channel="facebook")).status_code == 403
    assert (await anon.get(f"{API}/conversations/{cid}")).status_code == 401


@pytest.mark.skipif(
    not (os.environ.get("TEST_MONGO_URI") and os.environ.get("TEST_DATABASE_URL")),
    reason="nécessite un vrai MongoDB et un vrai PostgreSQL (CI)",
)
async def test_concurrent_replays_create_one_message(client, session_factory, mongo_db):
    """Même identifiant externe envoyé en parallèle : un seul message (opération atomique)."""
    pid = await _prospect(client)
    cid = (await _open(client, pid)).json()["conversation"]["id"]
    data = MessageCreate(role=SenderType.PROSPECT, content="x", external_message_id="race-1")

    async def _send():
        async with session_factory() as s:
            return await service.add_message(s, mongo_db, cid, data)

    results = await asyncio.gather(*[_send() for _ in range(8)])
    assert sum(1 for _, created in results if created) == 1
    assert len((await client.get(f"{API}/conversations/{cid}")).json()["messages"]) == 1
    async with session_factory() as s:
        assert (
            len((await s.scalars(select(Interaction).where(Interaction.type == "message"))).all())
            == 1
        )


@pytest.mark.skipif(not os.environ.get("TEST_MONGO_URI"), reason="nécessite un vrai MongoDB (CI)")
async def test_unique_active_conversation_index(client, mongo_db):
    """L'index partiel empêche deux conversations actives pour le même prospect et canal."""
    from pymongo.errors import DuplicateKeyError

    pid = await _prospect(client)
    await _open(client, pid)
    doc = {"prospect_id": pid, "channel": "email", "status": "open", "messages": []}
    with pytest.raises(DuplicateKeyError):
        await mongo_db["conversations"].insert_one(doc)


async def test_list_conversations_summaries_filtered_by_status(client):
    a = await _prospect(client, "a@example.com")
    b = await _prospect(client, "b@example.com")
    conv_a = (await _open(client, a, message=_msg(content="Premier"))).json()["conversation"]
    conv_b = (await _open(client, b)).json()["conversation"]
    await client.post(f"{API}/conversations/{conv_a['id']}/messages", json=_msg("agent", "Réponse"))
    await client.patch(f"{API}/conversations/{conv_b['id']}", json={"status": "handed_off"})

    everything = (await client.get(f"{API}/conversations")).json()
    assert everything["total"] == 2
    row = next(i for i in everything["items"] if i["id"] == conv_a["id"])
    assert row["message_count"] == 2 and row["last_message_role"] == "agent"
    assert row["last_message_preview"] == "Réponse" and "messages" not in row
    empty = next(i for i in everything["items"] if i["id"] == conv_b["id"])
    assert empty["message_count"] == 0 and empty["last_message_preview"] is None

    queue = (await client.get(f"{API}/conversations", params={"status": "handed_off"})).json()
    assert [i["id"] for i in queue["items"]] == [conv_b["id"]] and queue["total"] == 1
    assert (await client.get(f"{API}/conversations", params={"status": "nope"})).status_code == 422
