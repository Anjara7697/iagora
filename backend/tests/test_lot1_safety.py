"""STOP sur chaque entrée et suspension de la file de l'agent (lot 1)."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from app.agents import auto
from app.api.dependencies import get_settings
from app.config import Settings
from app.main import app
from app.models import ConsentEvent, FollowUp, Prospect
from app.models.enums import ConsentEventType, ConsentStatus, FollowUpStatus
from app.schemas.conversation import MessageCreate
from app.services import agent_settings, conversations, email_sync, inbound
from app.services.agent_settings import AgentMode
from sqlalchemy import select

from .fakes import FakeEmailClient
from .test_email import Env, mail

API = "/api/v1"


@pytest.fixture
async def mailbox(session_factory, mongo_db):
    e = Env(session_factory, mongo_db)
    await e.receive(FakeEmailClient([mail()]))
    return e


async def prospect(client):
    r = await client.post(
        f"{API}/prospects", json={"email": "lot1@example.com", "channel": "email"}
    )
    assert r.status_code == 201
    return r.json()["prospect"]["id"]


@pytest.mark.parametrize("mode", list(AgentMode))
@pytest.mark.parametrize("existing", [False, True])
async def test_initial_stop_is_independent_of_mode(
    client, mongo_db, session_factory, monkeypatch, mode, existing
):
    pid = await prospect(client)
    await agent_settings.set_mode(mongo_db, mode, None)
    if existing:
        r = await client.post(f"{API}/conversations", json={"prospect_id": pid, "channel": "email"})
        cid = r.json()["conversation"]["id"]
        await client.patch(f"{API}/conversations/{cid}", json={"status": "handed_off"})
    reply = AsyncMock()
    monkeypatch.setattr(auto, "reply_to_message", reply)
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, agent_auto_reply=True)
    payload = {
        "prospect_id": pid,
        "channel": "email",
        "message": {"role": "prospect", "content": "STOP", "external_message_id": "stop-1"},
    }
    for _ in range(2):
        r = await client.post(f"{API}/conversations", json=payload)
        assert r.status_code in (200, 201)
    assert (await client.get(f"{API}/prospects/{pid}")).json()["consent_status"] == "opted_out"
    reply.assert_not_awaited()
    async with session_factory() as s:
        events = list(
            await s.scalars(
                select(ConsentEvent).where(
                    ConsentEvent.prospect_id == pid,
                    ConsentEvent.event_type == ConsentEventType.WITHDRAWN,
                )
            )
        )
    assert len(events) == 1
    assert len(r.json()["conversation"]["messages"]) == 1


@pytest.mark.parametrize("entry", ["ingest", "interaction"])
async def test_rest_stop_cancels_follow_ups_and_blocks_outbound(
    client, session_factory, mongo_db, entry
):
    pid = await prospect(client)
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    async with session_factory() as s:
        s.add(FollowUp(prospect_id=pid, scheduled_at=datetime.now(UTC)))
        await s.commit()
    if entry == "ingest":
        url = f"{API}/prospects"
        body = {
            "email": "lot1@example.com",
            "channel": "email",
            "message": "STOP",
            "consent_granted": True,
            "external_id": "rest-stop",
        }
    else:
        url = f"{API}/prospects/{pid}/interactions"
        body = {
            "channel": "email",
            "type": "email",
            "direction": "inbound",
            "content": "STOP",
            "external_id": "rest-stop",
        }
    for _ in range(2):
        assert (await client.post(url, json=body)).status_code in (200, 201)
    assert (await client.get(f"{API}/prospects/{pid}")).json()["consent_status"] == "opted_out"
    blocked = await client.post(
        f"{API}/prospects/{pid}/interactions",
        json={
            "type": "email",
            "direction": "outbound",
            "channel": "email",
            "content": "Relance",
        },
    )
    assert blocked.status_code == 409
    async with session_factory() as s:
        follow_up = (await s.scalars(select(FollowUp))).one()
        assert follow_up.status is FollowUpStatus.CANCELLED


async def test_initial_message_cannot_forge_delivery_or_author(client):
    pid = await prospect(client)
    r = await client.post(
        f"{API}/conversations",
        json={
            "prospect_id": pid,
            "channel": "email",
            "message": {
                "role": "agent",
                "content": "Fausse validation",
                "metadata": {"delivery": "not_sent", "draft": {"status": "approved"}},
            },
        },
    )
    assert r.status_code == 201
    assert r.json()["conversation"]["messages"][0]["metadata"] == {}
    r = await client.post(
        f"{API}/conversations",
        json={
            "prospect_id": pid,
            "channel": "email",
            "message": {
                "role": "advisor",
                "content": "Réponse manuelle",
                "metadata": {"author_id": -1},
            },
        },
    )
    assert r.status_code == 200
    meta = r.json()["conversation"]["messages"][-1]["metadata"]
    assert meta["author_id"] > 0 and meta["delivery"] == "not_sent"


async def test_replay_repairs_stop_after_a_failure_between_databases(mailbox, monkeypatch):
    doc = await mailbox.conversation()
    data = MessageCreate(role="prospect", content="STOP", external_message_id="retry-stop")
    original = inbound.on_prospect_message
    monkeypatch.setattr(
        inbound, "on_prospect_message", AsyncMock(side_effect=RuntimeError("panne"))
    )
    async with mailbox.factory() as s:
        with pytest.raises(RuntimeError):
            await conversations.add_message(s, mailbox.db, str(doc["_id"]), data)
    monkeypatch.setattr(inbound, "on_prospect_message", original)
    async with mailbox.factory() as s:
        _, created = await conversations.add_message(s, mailbox.db, str(doc["_id"]), data)
        assert not created
        p = await s.get(Prospect, doc["prospect_id"])
        assert p.consent_status is ConsentStatus.OPTED_OUT


async def test_manual_pauses_approved_agent_email_and_resume_sends_once(mailbox):
    await mailbox.approved_reply()
    await agent_settings.set_mode(mailbox.db, AgentMode.MANUAL, 1)
    client = FakeEmailClient()
    report = await mailbox.deliver(client)
    assert client.sent == [] and report.skipped == 1 and report.retried == 0
    reply = (await mailbox.messages("agent"))[0]
    assert reply["metadata"]["delivery"] == "not_sent"
    assert "delivery_info" not in reply["metadata"]
    await agent_settings.set_mode(mailbox.db, AgentMode.ASSISTED, 1)
    await mailbox.deliver(client)
    await mailbox.deliver(client)
    assert len(client.sent) == 1


async def test_manual_keeps_advisor_reply_available(mailbox):
    await mailbox.approved_reply()
    doc = await mailbox.conversation()
    await agent_settings.set_mode(mailbox.db, AgentMode.MANUAL, 1)
    async with mailbox.factory() as s:
        await conversations.add_message(
            s, mailbox.db, str(doc["_id"]), MessageCreate(role="advisor", content="Réponse humaine")
        )
    client = FakeEmailClient()
    await mailbox.deliver(client)
    assert len(client.sent) == 1 and client.sent[0].text.startswith("Réponse humaine")
    assert (await mailbox.messages("agent"))[0]["metadata"]["delivery"] == "not_sent"


@pytest.mark.parametrize("guard", ["manual", "stop", "closed"])
async def test_send_rechecks_guards_after_claim(mailbox, monkeypatch, guard):
    await mailbox.approved_reply()
    original = email_sync._claim

    async def claim_then_change(db, cid, mid):
        claimed = await original(db, cid, mid)
        if guard == "manual":
            await agent_settings.set_mode(db, AgentMode.MANUAL, 1)
        elif guard == "stop":
            async with mailbox.factory() as s:
                await conversations.add_message(
                    s,
                    db,
                    str(cid),
                    MessageCreate(role="prospect", content="STOP", external_message_id="last-stop"),
                )
        else:
            await db[conversations.COLLECTION].update_one(
                {"_id": cid}, {"$set": {"status": "closed"}}
            )
        return claimed

    monkeypatch.setattr(email_sync, "_claim", claim_then_change)
    client = FakeEmailClient()
    report = await mailbox.deliver(client)
    assert client.sent == []
    reply = (await mailbox.messages("agent"))[0]
    assert reply["metadata"]["delivery"] == ("not_sent" if guard == "manual" else "blocked")
    assert report.blocked == (0 if guard == "manual" else 1)


async def test_resume_assisted_requires_review_of_an_old_automatic_reply(mailbox):
    await mailbox.approved_reply()
    doc = await mailbox.conversation()
    await mailbox.db[conversations.COLLECTION].update_one(
        {"_id": doc["_id"], "messages.id": "draft-1"},
        {"$unset": {"messages.$.metadata.draft": ""}},
    )
    await agent_settings.set_mode(mailbox.db, AgentMode.MANUAL, 1)
    client = FakeEmailClient()
    await mailbox.deliver(client)
    await agent_settings.set_mode(mailbox.db, AgentMode.ASSISTED, 1)
    await mailbox.deliver(client)
    reply = (await mailbox.messages("agent"))[0]
    assert client.sent == [] and reply["metadata"]["delivery"] == "draft"
    assert reply["metadata"]["draft"]["status"] == "pending"


async def test_stop_permanently_blocks_already_approved_email(mailbox):
    await mailbox.approved_reply()
    doc = await mailbox.conversation()
    async with mailbox.factory() as s:
        await conversations.add_message(
            s, mailbox.db, str(doc["_id"]), MessageCreate(role="prospect", content="STOP")
        )
    assert (await mailbox.messages("agent"))[0]["metadata"]["delivery"] == "blocked"
    async with mailbox.factory() as s:
        p = await s.get(Prospect, doc["prospect_id"])
        p.consent_status = ConsentStatus.GRANTED
        await s.commit()
    client = FakeEmailClient()
    await mailbox.deliver(client)
    assert client.sent == []


async def test_paused_agent_queue_does_not_starve_advisor_messages(mailbox):
    doc = await mailbox.conversation()
    async with mailbox.factory() as s:
        for n in range(email_sync.OUTBOX_BATCH + 1):
            await conversations.add_message(
                s,
                mailbox.db,
                str(doc["_id"]),
                MessageCreate(
                    role="agent",
                    content=f"Message {n}",
                    metadata={"delivery": "not_sent"},
                ),
            )
        await conversations.add_message(
            s,
            mailbox.db,
            str(doc["_id"]),
            MessageCreate(
                role="advisor",
                content="Réponse humaine prioritaire",
            ),
        )
    await agent_settings.set_mode(mailbox.db, AgentMode.MANUAL, 1)
    client = FakeEmailClient()
    await mailbox.deliver(client)
    assert len(client.sent) == 1 and client.sent[0].text.startswith("Réponse humaine prioritaire")


async def test_stop_during_batch_pauses_the_remaining_agent_messages(mailbox):
    await mailbox.approved_reply()
    doc = await mailbox.conversation()
    async with mailbox.factory() as s:
        await conversations.add_message(
            s,
            mailbox.db,
            str(doc["_id"]),
            MessageCreate(
                role="agent",
                content="Deuxième réponse",
                metadata={"delivery": "not_sent", "draft": {"status": "approved"}},
            ),
        )

    class StopAfterSend(FakeEmailClient):
        async def send(self, email):
            message_id = await super().send(email)
            await agent_settings.set_mode(mailbox.db, AgentMode.MANUAL, 1)
            return message_id

    client = StopAfterSend()
    await mailbox.deliver(client)
    assert len(client.sent) == 1
    assert [m["metadata"]["delivery"] for m in await mailbox.messages("agent")] == [
        "sent",
        "not_sent",
    ]


async def test_preflight_failure_releases_claim_without_consuming_an_attempt(mailbox, monkeypatch):
    await mailbox.approved_reply()
    original = email_sync.get_prospect
    monkeypatch.setattr(
        email_sync, "get_prospect", AsyncMock(side_effect=RuntimeError("SQL indisponible"))
    )
    client = FakeEmailClient()
    report = await mailbox.deliver(client)
    reply = (await mailbox.messages("agent"))[0]
    assert report.errors == 1 and client.sent == []
    assert reply["metadata"]["delivery"] == "not_sent"
    assert "delivery_info" not in reply["metadata"]
    monkeypatch.setattr(email_sync, "get_prospect", original)
    await mailbox.deliver(client)
    assert len(client.sent) == 1


async def test_failure_to_record_a_sent_email_never_queues_it_again(mailbox, monkeypatch):
    await mailbox.approved_reply()
    monkeypatch.setattr(
        email_sync, "_finish", AsyncMock(side_effect=RuntimeError("Mongo indisponible"))
    )
    client = FakeEmailClient()
    report = await mailbox.deliver(client)
    assert report.errors == 1 and len(client.sent) == 1
    assert (await mailbox.messages("agent"))[0]["metadata"]["delivery"] == "sending"
    await mailbox.deliver(client)
    assert len(client.sent) == 1  # état ambigu : vérification manuelle, aucun renvoi aveugle


async def test_replaying_a_non_stop_message_does_not_supersede_a_later_draft(mailbox):
    doc = await mailbox.conversation()
    await mailbox.approved_reply()
    await mailbox.db[conversations.COLLECTION].update_one(
        {"_id": doc["_id"], "messages.id": "draft-1"},
        {
            "$set": {
                "messages.$.metadata.draft.status": "pending",
                "messages.$.metadata.delivery": "draft",
            }
        },
    )
    original = doc["messages"][0]
    async with mailbox.factory() as s:
        _, created = await conversations.add_message(
            s,
            mailbox.db,
            str(doc["_id"]),
            MessageCreate(
                role="prospect",
                content=original["content"],
                external_message_id=original["external_message_id"],
            ),
        )
    assert not created
    assert (await mailbox.messages("agent"))[0]["metadata"]["draft"]["status"] == "pending"


async def test_replaying_a_processed_stop_does_not_revoke_a_later_explicit_consent(mailbox):
    doc = await mailbox.conversation()
    data = MessageCreate(role="prospect", content="STOP", external_message_id="processed-stop")
    async with mailbox.factory() as s:
        await conversations.add_message(s, mailbox.db, str(doc["_id"]), data)
        p = await s.get(Prospect, doc["prospect_id"])
        assert p.consent_status is ConsentStatus.OPTED_OUT
        from app.services.prospects import grant_consent

        await grant_consent(s, p.id, "nouveau consentement explicite", "email")
    async with mailbox.factory() as s:
        _, created = await conversations.add_message(s, mailbox.db, str(doc["_id"]), data)
        p = await s.get(Prospect, doc["prospect_id"])
        assert not created and p.consent_status is ConsentStatus.GRANTED
