"""Connecteur email : lecture des messages reçus, envoi des messages validés, garde-fous."""

import asyncio
import io
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import patch

import pytest
from app.agents import auto
from app.api.dependencies import get_email_client
from app.config import Settings, get_settings
from app.integrations.email.base import InboundEmail
from app.integrations.email.parsing import parse_inbound, strip_quoted
from app.main import app
from app.models import (
    Campaign,
    CampaignProspect,
    CampaignSource,
    CampaignTarget,
    Prospect,
    Source,
    Target,
)
from app.models.enums import CampaignStatus, ConsentStatus, ConversionStage, UserRole
from app.services import application_intake, conversations, drafts, email_sync, todo
from pypdf import PdfWriter
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


def mail(n=1, *, text="Bonjour, des infos ?", sender="jean@acme-corp.com", **over):
    fields = {
        "uid": str(n),
        "message_id": f"<m{n}@acme-corp.com>",
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


def raw_email(body, *, subject="Question", sender="Jean <jean@acme-corp.com>", **headers):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, "agent@datum.test", subject
    msg["Message-ID"] = "<abc@acme-corp.com>"
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
    assert parsed.from_address == "jean@acme-corp.com" and parsed.from_name == "Jean"
    assert (
        parsed.text == "Bonjour,\nje suis intéressé." and parsed.message_id == "<abc@acme-corp.com>"
    )
    assert not parsed.is_automatic and not parsed.suspect


def test_parse_inbound_keeps_small_supported_attachments_only():
    msg = EmailMessage()
    msg["From"] = "Jean <jean@demo.example.com>"
    msg["To"] = "agent@datum.test"
    msg.set_content("Voici mon dossier.")
    msg.add_attachment(
        b"Candidature eBIHAR", maintype="text", subtype="plain", filename="dossier.txt"
    )
    msg.add_attachment(
        b"MZignored", maintype="application", subtype="octet-stream", filename="run.exe"
    )
    msg.add_attachment(b"fake image", maintype="image", subtype="png", filename="dossier.png")
    parsed = parse_inbound("1", msg.as_bytes())
    assert parsed.attachments == [
        ("dossier.txt", "text/plain", b"Candidature eBIHAR"),
        ("dossier.png", "image/png", b"fake image"),
    ]


def test_pdf_application_text_is_read_with_document_evidence():
    pdf = (Path(__file__).parent / "data" / "candidature-demo.pdf").read_bytes()
    parsed = mail(91, attachments=[("candidature.pdf", "application/pdf", pdf)])
    evidence = application_intake.document_evidence(parsed)
    assert len(evidence) == 1
    assert "candidature" in evidence[0].text.lower()
    assert "eBIHAR" in evidence[0].text
    assert "autre@demo.example.com" in evidence[0].text
    broken = mail(92, attachments=[("dossier.pdf", "application/pdf", b"broken")])
    assert application_intake.document_evidence(broken)[0].note == "PDF illisible : à vérifier"


def test_scanned_pdf_is_ocr_read_and_marked_for_review():
    pdf = PdfWriter()
    pdf.add_blank_page(width=595, height=842)
    stream = io.BytesIO()
    pdf.write(stream)
    scanned = mail(93, attachments=[("scan.pdf", "application/pdf", stream.getvalue())])
    with patch.object(
        application_intake, "_ocr_pdf_page", return_value="Candidature eBIHAR"
    ) as ocr:
        evidence = application_intake.document_evidence(scanned)
    ocr.assert_called_once()
    assert evidence == [
        application_intake.DocumentEvidence("scan.pdf", "Candidature eBIHAR", "OCR à vérifier")
    ]


@pytest.mark.asyncio
async def test_scanned_image_can_trigger_application_review(env):
    image = mail(
        94, text="Bonjour, voir la pièce jointe.", attachments=[("scan.png", "image/png", b"image")]
    )
    with patch.object(application_intake, "_ocr_image", return_value="Candidature eBIHAR"):
        report = await env.receive(FakeEmailClient([image]))
    assert report.received == 1
    doc = await env.conversation()
    assert doc["handoff"]["reason"] == "candidature_a_verifier"
    assert "scan.png (OCR à vérifier)" in doc["handoff"]["summary"]


@pytest.mark.asyncio
async def test_application_suggests_only_active_matching_campaign(session_factory):
    async with session_factory() as session:
        target = await session.scalar(select(Target).where(Target.code == "ebihar_students"))
        assert target is not None
        active = Campaign(name="eBIHAR octobre", status=CampaignStatus.ACTIVE)
        inactive = Campaign(name="eBIHAR ancien", status=CampaignStatus.INACTIVE)
        session.add_all([active, inactive])
        await session.flush()
        session.add_all(
            [
                CampaignTarget(campaign_id=active.id, target_id=target.id),
                CampaignTarget(campaign_id=inactive.id, target_id=target.id),
            ]
        )
        await session.commit()
        suggestions = await application_intake.suggest_campaigns(
            session, "Je candidate au programme eBIHAR"
        )
        assert suggestions == ["eBIHAR octobre"]


@pytest.mark.asyncio
async def test_direct_application_creates_review_without_advancing_stage(env):
    client = FakeEmailClient(
        [
            mail(
                82,
                sender="direct@demo.example.com",
                text="J'ai envoyé mon dossier de candidature.",
                attachments=[
                    ("dossier.txt", "text/plain", b"Candidature eBIHAR\nautre@demo.example.com")
                ],
            )
        ]
    )
    report = await env.receive(client)
    assert report.received == 1
    assert env.replied == []
    doc = await env.conversation()
    assert doc["handoff"]["reason"] == "candidature_a_verifier"
    assert "autre@demo.example.com" in doc["handoff"]["summary"]
    async with env.factory() as session:
        queue = await todo.list_todo(session, env.db, kind="application", limit=25, offset=0)
        assert queue.total == 1
        assert queue.items[0].prospect.email == "direct@demo.example.com"
        assert queue.items[0].prospect.stage is None


@pytest.mark.asyncio
async def test_admissions_email_is_attached_to_unique_applied_candidate(env):
    async with env.factory() as session:
        candidate = Prospect(email="candidate@demo.example.com")
        campaign = Campaign(name="eBIHAR octobre", status=CampaignStatus.ACTIVE)
        source = Source(name="Dossier", type="email", platform="email")
        session.add_all([candidate, campaign, source])
        await session.flush()
        campaign_source = CampaignSource(campaign_id=campaign.id, source_id=source.id)
        session.add(campaign_source)
        await session.flush()
        session.add(
            CampaignProspect(
                prospect_id=candidate.id,
                campaign_source_id=campaign_source.id,
                conversion_stage=ConversionStage.APPLIED,
            )
        )
        await session.commit()
        candidate_id = candidate.id

    incoming = mail(
        83,
        sender="admissions@school.example.com",
        text=("L'admission est confirmée pour candidate@demo.example.com au programme eBIHAR."),
        subject="Admission confirmée",
        is_automatic=True,
    )
    report = await env.receive(FakeEmailClient([incoming]))
    assert report.received == 1
    assert env.replied == []
    doc = await env.conversation()
    assert doc["prospect_id"] == candidate_id
    assert doc["handoff"]["reason"] == "inscription_a_verifier"
    assert doc["messages"][0]["metadata"]["email"]["evidence_only"] is True
    assert drafts.live_messages(doc["messages"]) == []
    async with env.factory() as session:
        prospects = list(await session.scalars(select(Prospect)))
        queue = await todo.list_todo(session, env.db, kind="enrollment", limit=25, offset=0)
    assert [prospect.email for prospect in prospects] == ["candidate@demo.example.com"]
    assert queue.total == 1
    assert queue.items[0].prospect.email == "candidate@demo.example.com"


@pytest.mark.asyncio
async def test_unmatched_admission_email_does_not_create_or_trigger_reply(env):
    incoming = mail(
        84,
        sender="admissions@school.example.com",
        text="L'admission est confirmée pour unknown@demo.example.com.",
        subject="Admission confirmée",
    )
    report = await env.receive(FakeEmailClient([incoming]))
    assert report.skipped == 1 and report.received == 0
    assert "non rattachée" in report.notes[0]
    assert env.replied == []
    assert await env.conversation() is None
    async with env.factory() as session:
        assert list(await session.scalars(select(Prospect))) == []


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
    assert prospect.email == "jean@acme-corp.com" and prospect.first_name == "Jean"
    assert prospect.consent_status is ConsentStatus.GRANTED
    (message,) = await env.messages("prospect")
    assert message["content"].startswith("Renseignements") and "des infos" in message["content"]
    assert message["external_message_id"] == "<m1@acme-corp.com>"
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

    client = FakeEmailClient([mail(1), mail(2, sender="paul@acme-corp.com")])
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
    assert out.to_address == "jean@acme-corp.com" and out.subject == "Re: Renseignements"
    assert out.in_reply_to == "<m1@acme-corp.com>"
    assert out.references == ["<old@x>", "<m1@acme-corp.com>"]
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
    await env.deliver(client, email_sandbox_recipients="Jean@Acme-Corp.com, autre@x.test")
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


def test_the_loop_stays_idle_without_credentials_and_rereads_its_configuration(monkeypatch):
    """Sans boîte configurée, la boucle attend sans rien faire ; elle relit la configuration à
    chaque passage (console ou .env) : une boîte ajoutée plus tard est prise sans redémarrage."""
    from mongomock_motor import AsyncMongoMockClient

    cycles, reads = [], []

    async def fake_cycle(*args, **kwargs):
        cycles.append(1)

    async def fake_effective(db, base):
        reads.append(1)
        return base

    class Stop(Exception):
        pass

    async def stop_after_two(_seconds):
        if len(reads) >= 2:
            raise Stop

    import app.database.clients as clients
    from app.services import email_config

    monkeypatch.setattr(auto, "email_cycle", fake_cycle)
    monkeypatch.setattr(email_config, "effective_settings", fake_effective)
    monkeypatch.setattr(clients, "get_mongo_db", lambda: AsyncMongoMockClient()["t"])
    monkeypatch.setattr(auto.asyncio, "sleep", stop_after_two)
    with pytest.raises(Stop):
        asyncio.run(auto.email_loop(Settings(_env_file=None, email_enabled=True)))
    assert reads == [1, 1] and cycles == []


async def test_fictitious_addresses_never_receive_a_real_email(env):
    await env.receive(FakeEmailClient([mail(sender="sim.jean@demo.example.com")]))
    await env.approved_reply()
    client = FakeEmailClient()
    report = await env.deliver(client)
    assert report.blocked == 1 and client.sent == []
    reply = (await env.messages("agent"))[0]
    assert "fictive" in reply["metadata"]["delivery_info"]["reason"]


async def test_a_stop_by_email_unsubscribes_even_when_the_agent_cannot_answer(env):
    await env.receive(FakeEmailClient([mail(text="STOP, ne m'écrivez plus.")]))
    async with env.factory() as s:
        prospect = (await s.scalars(select(Prospect))).one()
    assert prospect.consent_status is ConsentStatus.OPTED_OUT and env.replied == []


async def test_a_message_in_a_closed_conversation_is_not_sent(env):
    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    doc = await env.conversation()
    await env.db[conversations.COLLECTION].update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "closed"}}
    )
    client = FakeEmailClient()
    report = await env.deliver(client)
    assert report.blocked == 1 and client.sent == []


async def test_a_poison_email_is_set_aside_after_three_failures(env, monkeypatch):
    async def boom(*_args, **_kwargs):
        raise RuntimeError("email illisible")

    monkeypatch.setattr(email_sync, "_ingest_email", boom)
    client = FakeEmailClient([mail()])
    for expected_seen in ([], [], ["1"]):
        await env.receive(client)
        assert client.seen == expected_seen


async def test_an_unexpected_error_while_sending_does_not_leave_the_message_stuck(env):
    class Broken(FakeEmailClient):
        async def send(self, email):
            raise ValueError("en-tête invalide")

    await env.receive(FakeEmailClient([mail()]))
    await env.approved_reply()
    await env.deliver(Broken())
    reply = (await env.messages("agent"))[0]
    assert reply["metadata"]["delivery"] == "not_sent"  # sera retenté, pas bloqué en `sending`


class _FakeImap:
    def __init__(self, known: str):
        self.known = known
        self.selected: list[str] = []

    def select(self, name: str):
        self.selected.append(name)
        return ("OK", [b"0"]) if name == f'"{self.known}"' else ("NO", [b"inexistant"])

    def uid(self, command: str, *args):
        return ("OK", [b""])

    def logout(self):
        return ("BYE", [])


def _imap_client(monkeypatch, folder: str, known: str):
    from app.integrations.email.imap_smtp import ImapSmtpClient

    client = ImapSmtpClient(settings(email_imap_folder=folder))
    fake = _FakeImap(known)
    monkeypatch.setattr(client, "_imap", lambda: fake)
    return client, fake


def test_imap_folder_with_space_is_quoted(monkeypatch):
    client, fake = _imap_client(monkeypatch, "INBOX/IA GORA_TEST", "INBOX/IA GORA_TEST")
    assert asyncio.run(client.fetch_unseen()) == []
    assert fake.selected == ['"INBOX/IA GORA_TEST"']


def test_unknown_imap_folder_is_an_explicit_error(monkeypatch):
    from app.integrations.email.base import EmailError

    client, _ = _imap_client(monkeypatch, "IAGORA_TEST", "INBOX")
    with pytest.raises(EmailError, match="IAGORA_TEST"):
        asyncio.run(client.fetch_unseen())


def test_mark_unseen_from_clears_the_seen_flag_of_that_sender(monkeypatch):
    class Imap(_FakeImap):
        def __init__(self):
            super().__init__("INBOX")
            self.stored: list[tuple] = []

        def uid(self, command, *args):
            if command == "SEARCH":
                return ("OK", [b"4 7"])
            self.stored.append(args)
            return ("OK", [])

    client, _ = _imap_client(monkeypatch, "INBOX", "INBOX")
    fake = Imap()
    monkeypatch.setattr(client, "_imap", lambda: fake)
    assert asyncio.run(client.mark_unseen_from("moi@gmail.com")) == 2
    assert [a[0] for a in fake.stored] == [b"4", b"7"]
    assert all(a[1:] == ("-FLAGS", "(\\Seen)") for a in fake.stored)
