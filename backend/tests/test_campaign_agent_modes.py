"""Autonomie de l'agent par campagne et par type de message (D-51)."""

from datetime import timedelta
from types import SimpleNamespace

from app.config import Settings
from app.models import FollowUp
from app.models.enums import UserRole
from app.services import agent_settings, commercial_context, drafts, email_sync, follow_ups
from app.services.agent_settings import AgentMode, MessageKind
from bson import ObjectId
from sqlalchemy import delete

from .test_agent_workflow import conversation, lead, run
from .test_agent_workflow import env as env  # noqa: F401  (fixture)
from .test_auto_agent import agent_messages, execute, silent_prospect, statuses
from .test_email import FakeEmailClient

API = "/api/v1"


async def campaign_of(session_factory, pid):
    async with session_factory() as s:
        return (await commercial_context.campaign_ids(s, [pid]))[pid]


async def put_modes(client, campaign_id, **modes):
    return await client.put(f"{API}/campaigns/{campaign_id}/agent-modes", json=modes)


async def last_agent_message(client, cid):
    conv = await conversation(client, cid)
    return [m for m in conv["messages"] if m["role"] == "agent"][-1]


# --- Réglage ---


async def test_a_campaign_follows_the_global_setting_by_default(
    client, env, mongo_db, session_factory
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, _, _ = await lead(client)
    camp = await campaign_of(session_factory, pid)
    body = (await client.get(f"{API}/campaigns/{camp}/agent-modes")).json()
    assert body["overrides"] == {"first_contact": None, "reply": None, "follow_up": None}
    assert body["effective"] == {
        "first_contact": "assisted",
        "reply": "assisted",
        "follow_up": "assisted",
    }
    assert body["global_mode"] == "assisted" and body["auto_allowed"] is True


async def test_only_an_admin_changes_the_campaign_setting(
    client, env, make_client, session_factory
):
    pid, _, _ = await lead(client)
    camp = await campaign_of(session_factory, pid)
    advisor = await make_client(UserRole.ADVISOR)
    assert (await put_modes(advisor, camp, reply="manual")).status_code == 403
    assert (await advisor.get(f"{API}/campaigns/{camp}/agent-modes")).status_code == 200
    ok = await put_modes(client, camp, reply="manual", follow_up="auto")
    assert ok.status_code == 200
    body = ok.json()
    assert body["overrides"] == {"first_contact": None, "reply": "manual", "follow_up": "auto"}
    assert body["updated_by"] is not None and body["updated_at"]
    # Revenir au réglage général : null
    back = (await put_modes(client, camp)).json()
    assert back["overrides"] == {"first_contact": None, "reply": None, "follow_up": None}
    assert (await client.get(f"{API}/campaigns/999999/agent-modes")).status_code == 404


async def test_emergency_stop_wins_over_every_campaign(client, env, mongo_db, session_factory):
    pid, _, cid = await lead(client)
    camp = await campaign_of(session_factory, pid)
    await put_modes(client, camp, reply="auto", first_contact="assisted")
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    body = (await client.get(f"{API}/campaigns/{camp}/agent-modes")).json()
    assert set(body["effective"].values()) == {"manual"}
    assert body["overrides"]["reply"] == "auto"  # le réglage est gardé pour la reprise
    assert (await run(client, cid)).status_code == 409


async def test_auto_stays_refused_in_production_even_on_a_campaign(
    client, env, mongo_db, session_factory, monkeypatch
):
    pid, _, cid = await lead(client)
    camp = await campaign_of(session_factory, pid)
    await agent_settings.set_campaign_modes(mongo_db, camp, {MessageKind.REPLY: AgentMode.AUTO}, 1)
    monkeypatch.setattr(
        agent_settings, "get_settings", lambda: SimpleNamespace(environment="production")
    )
    refused = await put_modes(client, camp, reply="auto")
    assert refused.status_code == 409 and "production" in refused.json()["detail"]
    body = (await client.get(f"{API}/campaigns/{camp}/agent-modes")).json()
    assert body["effective"]["reply"] == "assisted" and body["auto_allowed"] is False
    assert (await run(client, cid)).status_code == 201
    assert (await last_agent_message(client, cid))["metadata"]["draft"]["status"] == "pending"


# --- Réponses ---


async def test_a_campaign_in_auto_skips_validation_while_the_rest_stays_assisted(
    client, env, mongo_db, session_factory
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, _, cid = await lead(client)
    other_pid, _, other_cid = await lead(client, email="paul@example.com", phone="0698765432")
    await put_modes(client, await campaign_of(session_factory, pid), reply="auto")

    assert (await run(client, cid)).status_code == 201
    direct = await last_agent_message(client, cid)
    assert direct["metadata"]["delivery"] == "not_sent" and "draft" not in direct["metadata"]
    other = await run(client, other_cid)
    assert other.status_code == 201, other.text
    assert (await last_agent_message(client, other_cid))["metadata"]["delivery"] == "draft"


async def test_a_campaign_in_assisted_drafts_even_when_the_global_is_auto(
    client, env, session_factory
):
    pid, _, cid = await lead(client)  # env : réglage général automatique
    await put_modes(client, await campaign_of(session_factory, pid), reply="assisted")
    assert (await run(client, cid)).status_code == 201
    assert (await last_agent_message(client, cid))["metadata"]["draft"]["status"] == "pending"


async def test_a_campaign_can_stop_the_agent_on_replies_only(client, env, session_factory):
    pid, _, cid = await lead(client)
    other_pid, _, other_cid = await lead(client, email="paul@example.com", phone="0698765432")
    await put_modes(client, await campaign_of(session_factory, pid), reply="manual")
    stopped = await run(client, cid)
    assert stopped.status_code == 409 and "campagne" in stopped.json()["detail"]
    assert (await conversation(client, cid))["messages"][-1]["role"] == "prospect"
    assert (await run(client, other_cid)).status_code == 201  # les autres campagnes continuent


async def test_regenerating_is_refused_when_the_campaign_stopped_replies(
    client, env, mongo_db, session_factory
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, _, cid = await lead(client)
    await run(client, cid)
    draft = await last_agent_message(client, cid)
    await put_modes(client, await campaign_of(session_factory, pid), reply="manual")
    url = f"{API}/conversations/{cid}/drafts/{draft['id']}/regenerate"
    refused = await client.post(url, json={})
    assert refused.status_code == 409
    # le brouillon est conservé, un conseiller peut encore le valider ou le refuser
    assert (await last_agent_message(client, cid))["metadata"]["draft"]["status"] == "pending"


# --- Premiers contacts ---


async def test_first_contacts_are_refused_when_the_campaign_stopped_them(
    client, env, session_factory
):
    pid, _, _ = await lead(client, text=None, consent_status="granted")
    camp = await campaign_of(session_factory, pid)
    await put_modes(client, camp, first_contact="manual")
    refused = await client.post(f"{API}/campaigns/{camp}/first-contacts")
    assert refused.status_code == 409 and "Réglages" in refused.json()["detail"]
    await put_modes(client, camp, first_contact="assisted")
    assert (await client.post(f"{API}/campaigns/{camp}/first-contacts")).status_code == 200


# --- Relances ---


async def test_follow_ups_of_a_stopped_campaign_wait_and_resume(
    client, env, session_factory, mongo_db
):
    pid, _, cid = await silent_prospect(client, session_factory)
    other_pid, other_mid, other_cid = await lead(
        client, email="paul@example.com", phone="0698765432"
    )
    await run(client, other_cid)
    async with session_factory() as s:
        await s.execute(delete(FollowUp).where(FollowUp.prospect_id == other_pid))
        await follow_ups.schedule_follow_up(
            s, other_pid, other_mid, "email", timedelta(days=-1), "T"
        )
    camp = await campaign_of(session_factory, pid)
    await put_modes(client, camp, follow_up="manual")

    summary = await execute(session_factory, mongo_db, env)
    assert summary.executed == 1  # seule celle de l'autre campagne part
    assert await statuses(session_factory, pid) == ["scheduled"]
    assert await statuses(session_factory, other_pid) == ["executed", "scheduled"]

    await put_modes(client, camp)  # retour au réglage général
    await execute(session_factory, mongo_db, env)
    assert await statuses(session_factory, pid) == ["executed", "scheduled"]


async def test_follow_ups_can_be_automatic_on_one_campaign(client, env, session_factory, mongo_db):
    pid, _, cid = await silent_prospect(client, session_factory)
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    await put_modes(client, await campaign_of(session_factory, pid), follow_up="auto")
    assert (await execute(session_factory, mongo_db, env)).executed == 1
    reminder = (await agent_messages(client, cid))[-1]
    assert "follow_up" in reminder["metadata"] and "draft" not in reminder["metadata"]


# --- Envoi des emails ---


def send_settings():
    return Settings(_env_file=None, email_enabled=True, email_send_enabled=True)


async def only(mongo_db, cid, message):
    await mongo_db["conversations"].update_one(
        {"_id": ObjectId(cid)}, {"$set": {"messages": [message]}}
    )


async def test_validated_emails_of_a_stopped_campaign_wait_without_blocking_others(
    client, env, session_factory, mongo_db
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, _, cid = await lead(client, email="jean@acme-corp.com")
    other_pid, _, other_cid = await lead(client, email="paul@acme-corp.com", phone="0698765432")
    for conv_id in (cid, other_cid):
        await run(client, conv_id)
        draft = await last_agent_message(client, conv_id)
        await drafts.approve(mongo_db, conv_id, draft["id"], 1, None)
        await only(mongo_db, conv_id, await last_agent_message(client, conv_id))
    await put_modes(client, await campaign_of(session_factory, pid), reply="manual")

    transport = FakeEmailClient()
    report = await email_sync.deliver_outbox(session_factory, mongo_db, transport, send_settings())
    assert report.sent == 1 and [m.to_address for m in transport.sent] == ["paul@acme-corp.com"]
    assert "envois de l'agent suspendus (campagne arrêtée)" in report.notes
    waiting = await last_agent_message(client, cid)
    assert waiting["metadata"]["delivery"] == "not_sent"


async def test_an_automatic_campaign_message_is_not_sent_back_to_review(
    client, env, session_factory, mongo_db
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, _, cid = await lead(client, email="jean@acme-corp.com")
    camp = await campaign_of(session_factory, pid)
    await put_modes(client, camp, reply="auto")
    await run(client, cid)
    await only(mongo_db, cid, await last_agent_message(client, cid))

    transport = FakeEmailClient()
    report = await email_sync.deliver_outbox(session_factory, mongo_db, transport, send_settings())
    assert report.sent == 1

    # La campagne repasse en validation : un ancien message automatique repasse en brouillon.
    pid2, _, cid2 = await lead(client, email="paul@acme-corp.com", phone="0698765432")
    camp2 = await campaign_of(session_factory, pid2)
    await put_modes(client, camp2, reply="auto")
    await run(client, cid2)
    await only(mongo_db, cid2, await last_agent_message(client, cid2))
    await put_modes(client, camp2, reply="assisted")
    report = await email_sync.deliver_outbox(session_factory, mongo_db, transport, send_settings())
    assert report.sent == 0
    assert (await last_agent_message(client, cid2))["metadata"]["draft"]["status"] == "pending"
