"""Connecteur email : lecture des messages reçus, envoi des messages validés, garde-fous."""

import asyncio
from datetime import UTC, datetime
from email.message import EmailMessage

import pytest
from app.agents import auto
from app.api.dependencies import get_email_client
from app.config import Settings, get_settings
from app.integrations.email.base import InboundEmail
from app.integrations.email.parsing import parse_inbound, strip_quoted
from app.main import app
from app.models import Prospect
from app.models.enums import ConsentStatus, UserRole
from app.services import conversations, drafts, email_sync
from sqlalchemy import select

from .fakes import FakeEmailClient

API = "/api/v1"
NOW = datetime(2027, 3, 3, 9, 0, tzinfo=UTC)


def settings(**over) -> Settings:
    base = {
        "email_enabled": True,
        "email_username": "agent@datum.test",
        "email_send_enabled": True,
        **over,
    }
    return Settings(_env_file=None, **base)


def mail(n=1, *, text="Bonjour, des infos ?", sender="jean@demo.example.com", **over):
    fields = {
        "uid": str(n),
        "message_id": f"<m{n}@demo.example.com>",
        "from_address": sender,
        "from_name": "Jean Dupont",
        "subject": "Renseignements",
        "text": text,
        "received_at": NOW,
    }
    return InboundEmail(**{**fields, **over})


class Env:
    def __init__(self, session_factory, mongo_db):
        self.factory = session_factory
        self.db = mongo_db
        self.replied: list[str] = []

    async def on_message(self, conversation_id: str) -> None:
        self.replied.append(conversation_id)

    async def receive(self, client, **over):
        return await email_sync.sync_inbound(
            self.factory, self.db, client, settings(**over), self.on_message
        )

    async def deliver(self, client, **over):
        return await email_sync.deliver_outbox(self.factory, self.db, client, settings(**over))

    async def conversation(self):
        return await self.db[conversations.COLLECTION].find_one({})

    async def messages(self, role):
        doc = await self.conversation()
        return [m for m in doc["messages"] if m["role"] == role]

    async def approved_reply(self, text="Voici les informations demandées."):
        """Un brouillon de l'agent validé par un conseiller (prêt à partir)."""
        doc = await self.conversation()
        message = {
            "id": "draft-1",
            "role": "agent",
            "content": text,
            "external_message_id": None,
            "created_at": datetime.now(UTC),
            "metadata": {"delivery": "draft", "draft": {"status": "pending"}},
        }
        await self.db[conversations.COLLECTION].update_one(
            {"_id": doc["_id"]}, {"$push": {"messages": message}}
        )
        await drafts.approve(self.db, str(doc["_id"]), "draft-1", 1, None)


@pytest.fixture
def env(session_factory, mongo_db):
    return Env(session_factory, mongo_db)


# --- Lecture d'un email ---


def raw_email(body, *, subject="Question", sender="Jean <jean@demo.example.com>", **headers):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, "agent@datum.test", subject
    msg["Message-ID"] = "<abc@demo.example.com>"
    for key, value in headers.items():
        msg[key.replace("_", "-")] = value
    msg.set_content(body)
    return msg.as_bytes()


def test_quoted_history_is_removed():
    text = "Oui, merci.\n\nLe 3 mars 2027 à 10:00, DATUM a écrit :\n> Bonjour\n> Cordialement"
    assert strip_quoted(text) == "Oui, merci."
    assert strip_quoted("Réponse\n> citation\nsuite") == "Réponse\nsuite"


def test_parse_inbound_extracts_sender_and_text():
    parsed = parse_inbound("7", raw_email("Bonjour,\nje suis intéressé."))
    assert parsed.from_address == "jean@demo.example.com" and parsed.from_name == "Jean"
    assert (
        parsed.text == "Bonjour,\nje suis intéressé."
        and parsed.message_id == "<abc@demo.example.com>"
    )
    assert not parsed.is_automatic and not parsed.suspect


def test_automatic_messages_and_failed_authentication_are_flagged():
    assert parse_inbound("1", raw_email("Absent", Auto_Submitted="auto-replied")).is_automatic
    assert parse_inbound("2", raw_email("Rebond", sender="MAILER-DAEMON@x.test")).is_automatic
    spoofed = parse_inbound("3", raw_email("Salut", Authentication_Results="mx; dmarc=fail"))
    assert spoofed.suspect


# --- Réception ---


async def test_a_new_sender_becomes_a_prospect_with_a_conversation(env):
    client = FakeEmailClient([mail()])
    report = await env.receive(client)
    assert report.received == 1 and client.seen == ["1"]
    async with env.factory() as s:
        prospect = (await s.scalars(select(Prospect))).one()
    assert prospect.email == "jean@demo.example.com" and prospect.first_name == "Jean"
    assert prospect.consent_status is ConsentStatus.GRANTED
    (message,) = await env.messages("prospect")
    assert message["content"].startswith("Renseignements") and "des infos" in message["content"]
    assert message["external_message_id"] == "<m1@demo.example.com>"
    assert len(env.replied) == 1  # l'agent est sollicité


async def test_reading_the_same_email_twice_creates_no_duplicate(env):
    client = FakeEmailClient([mail()])
    await env.receive(client)
    client.seen.clear()  # le serveur le propose à nouveau (drapeau perdu)
    report = await env.receive(client)
    assert report.received == 0 and report.duplicates == 1
    assert len(await env.messages("prospect")) == 1 and len(env.replied) == 1


async def test_a_second_email_joins_the_same_conversation(env):
    await env.receive(FakeEmailClient([mail(1), mail(2, text="Autre question")]))
    assert len(await env.db[conversations.COLLECTION].find({}).to_list(None)) == 1
    assert len(await env.messages("prospect")) == 2


async def test_automatic_and_own_messages_are_ignored_but_marked_read(env):
    client = FakeEmailClient([mail(1, is_automatic=True), mail(2, sender="agent@datum.test")])
    report = await env.receive(client)
    assert report.skipped == 2 and report.received == 0 and client.seen == ["1", "2"]
    assert await env.conversation() is None


async def test_a_suspect_email_is_kept_but_the_agent_does_not_answer(env):
    report = await env.receive(FakeEmailClient([mail(suspect=True)]))
    assert report.received == 1 and env.replied == []
    assert len(await env.messages("prospect")) == 1


async def test_unknown_senders_can_be_refused(env):
    client = FakeEmailClient([mail()])
    report = await env.receive(client, email_create_unknown_senders=False)
    assert report.skipped == 1 and await env.conversation() is None and client.seen == ["1"]


async def test_an_agent_failure_does_not_stop_the_reception(env):
    async def boom(_):
        raise RuntimeError("panne")

    client = FakeEmailClient([mail(1), mail(2, sender="paul@demo.example.com")])
    report = await email_sync.sync_inbound(env.factory, env.db, client, settings(), boom)
    assert report.received == 2 and report.errors == 2 and client.seen == ["1", "2"]


# --- Envoi ---


async def test_a_validated_reply_is_sent_in_the_same_thread(env):
    inbox = FakeEmailClient([mail(references=["<old@x>"])])
    await env.receive(inbox)
    await env.approved_reply()
    client = FakeEmailClient()
    report = await env.deliver(client)
    assert report.sent == 1
    (out,) = client.sent
    assert out.to_address == "jean@demo.example.com" and out.subject == "Re: Renseignements"
    assert out.in_reply_to == "<m1@demo.example.com>"
    assert out.references == ["<old@x>", "<m1@demo.example.com>"]
    assert out.text.startswith("Voici les informations") and "STOP" in out.text
    (reply,) = await env.messages("agent")
    assert reply["metadata"]["delivery"] == "sent"
    assert reply["metadata"]["delivery_info"]["email_message_id"] == "<sent-1@fake.test>"
    assert (
        reply["metadata"]["draft"]["status"] == "approved"
    )  # le reste des métadonnées est conservé


async def test_sending_is_disabled_by_default(env):
    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    client = FakeEmailClient()
    await env.deliver(client, email_send_enabled=False)
    assert client.sent == []
    assert (await env.messages("agent"))[0]["metadata"]["delivery"] == "not_sent"


async def test_pending_drafts_are_never_sent(env):
    await env.receive(FakeEmailClient([mail()]))
    doc = await env.conversation()
    await env.db[conversations.COLLECTION].update_one(
        {"_id": doc["_id"]},
        {
            "$push": {
                "messages": {
                    "id": "d",
                    "role": "agent",
                    "content": "brouillon",
                    "created_at": NOW,
                    "metadata": {"delivery": "draft"},
                }
            }
        },
    )
    client = FakeEmailClient()
    await env.deliver(client)
    assert client.sent == []


async def test_sandbox_blocks_other_recipients(env):
    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    client = FakeEmailClient()
    report = await env.deliver(client, email_sandbox_recipients="moi@test.example.com")
    assert report.blocked == 1 and client.sent == []
    reply = (await env.messages("agent"))[0]
    assert (
        reply["metadata"]["delivery"] == "blocked"
        and "bac à sable" in reply["metadata"]["delivery_info"]["reason"]
    )


async def test_sandbox_allows_listed_recipients(env):
    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    client = FakeEmailClient()
    await env.deliver(client, email_sandbox_recipients="Jean@Demo.example.com, autre@x.test")
    assert len(client.sent) == 1


async def test_nothing_is_sent_to_an_opted_out_prospect(env):
    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    async with env.factory() as s:
        prospect = (await s.scalars(select(Prospect))).one()
        prospect.consent_status = ConsentStatus.OPTED_OUT
        await s.commit()
    client = FakeEmailClient()
    report = await env.deliver(client)
    assert report.blocked == 1 and client.sent == []


async def test_a_refused_send_is_retried_then_given_up(env):
    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    client = FakeEmailClient(fail_sends=10)
    for expected in ("not_sent", "not_sent", "failed"):
        await env.deliver(client)
        assert (await env.messages("agent"))[0]["metadata"]["delivery"] == expected
    assert (await env.messages("agent"))[0]["metadata"]["delivery_info"]["attempts"] == 3
    await env.deliver(client)  # un message en échec n'est plus repris
    assert client.sent == []


async def test_two_concurrent_runs_send_a_message_only_once(env):
    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    client = FakeEmailClient()
    await asyncio.gather(env.deliver(client), env.deliver(client))
    assert len(client.sent) == 1


async def test_an_advisor_message_is_ready_to_send(client, env):
    inbox = FakeEmailClient([mail()])
    await env.receive(inbox)
    doc = await env.conversation()
    r = await client.post(
        f"{API}/conversations/{doc['_id']}/messages", json={"role": "advisor", "content": "Bonjour"}
    )
    assert r.status_code == 201 and r.json()["message"]["metadata"]["delivery"] == "not_sent"
    out = FakeEmailClient()
    await env.deliver(out)
    assert len(out.sent) == 1


# --- Cycle complet et API ---


async def test_a_mailbox_failure_is_recorded_not_raised(env):
    client = FakeEmailClient()
    client.unreachable = True
    await email_sync.run_email_cycle(env.factory, env.db, client, settings())
    state = await email_sync.get_state(env.db)
    assert "connexion impossible" in state["last_error"]


async def test_the_cycle_receives_then_sends(env):
    client = FakeEmailClient([mail()])
    await env.receive(FakeEmailClient([mail()]))  # prépare la conversation
    await env.approved_reply()
    report = await email_sync.run_email_cycle(env.factory, env.db, client, settings())
    assert report.sent == 1 and (await email_sync.get_state(env.db))["last_error"] is None
    assert (await email_sync.outbox_counts(env.db)) == {"sent": 1}


async def test_integration_endpoints_are_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/integrations/email")).status_code == 403
    assert (await advisor.post(f"{API}/integrations/email/check")).status_code == 403


async def test_status_reports_configuration_without_secrets(client):
    app.dependency_overrides[get_settings] = lambda: settings(
        email_password="secret-value", email_sandbox_recipients="a@x.test"
    )
    r = await client.get(f"{API}/integrations/email")
    body = r.json()
    assert (
        body["configured"] and body["send_enabled"] and body["sandbox_recipients"] == ["a@x.test"]
    )
    assert "secret-value" not in r.text


async def test_check_and_sync_need_a_configured_mailbox(client):
    app.dependency_overrides[get_email_client] = lambda: None
    assert (await client.post(f"{API}/integrations/email/check")).status_code == 503
    assert (await client.post(f"{API}/integrations/email/sync")).status_code == 503


async def test_check_and_manual_sync(client, env):
    fake = FakeEmailClient([mail()])
    app.dependency_overrides[get_email_client] = lambda: fake
    app.dependency_overrides[get_settings] = lambda: settings(agent_auto_reply=False)
    assert (await client.post(f"{API}/integrations/email/check")).json() == {
        "imap": "ok",
        "smtp": "ok",
    }
    r = await client.post(f"{API}/integrations/email/sync")
    assert r.status_code == 200 and r.json()["report"]["received"] == 1
    status = (await client.get(f"{API}/integrations/email")).json()
    assert status["last_run_at"] is not None and status["last_error"] is None


def test_the_agent_loop_does_not_start_without_credentials():
    assert asyncio.run(auto.email_loop(Settings(_env_file=None, email_enabled=True))) is None
