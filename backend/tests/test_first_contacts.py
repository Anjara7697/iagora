"""Import d'une liste dans une campagne puis premiers contacts préparés par lot (décision D-29)."""

from datetime import UTC, datetime

from app.agents import auto
from app.config import Settings
from app.models.enums import UserRole
from app.services import agent_settings, conversations, drafts, email_sync
from app.services.agent_settings import AgentMode

from .fakes import FakeEmailClient
from .test_agent_workflow import env as env  # noqa: F401

API = "/api/v1"
CSV = (
    "prénom;email;téléphone;consentement\n"
    "Alice;alice@demo.example.com;;oui\n"
    "Bruno;bruno@demo.example.com;;non\n"
    "Chloé;;0611223344;oui\n"
    "David;david@demo.example.com;;x\n"
)


async def campaign(client, status="active"):
    r = await client.post(
        f"{API}/campaigns",
        json={
            "name": "Salon de l'étudiant",
            "status": status,
            "target_codes": ["ebihar_students"],
            "sources": [{"name": "Import CSV", "platform": "web", "type": "import"}],
        },
    )
    assert r.status_code == 201
    body = r.json()
    return body["id"], body["sources"][0]["id"]


async def import_csv(client, campaign_id, source_id, text=CSV, *, consent=False, dry_run=False):
    return await client.post(
        f"{API}/prospects/import",
        files={"file": ("salon.csv", text.encode(), "text/csv")},
        data={
            "dry_run": str(dry_run).lower(),
            "consent": str(consent).lower(),
            "campaign_id": str(campaign_id),
            "source_id": str(source_id),
            "target_code": "ebihar_students",
        },
    )


async def process_queue(mongo_db, session_factory, env):  # noqa: F811
    # Réglage par défaut de l'application : mode assisté, chaque premier contact est un brouillon.
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    await auto.run_pending_replies(
        session_factory=session_factory,
        db=mongo_db,
        llm=env.llm,
        calendar=env.calendar,
        knowledge=env.kb,
    )


async def test_consent_column_decides_row_by_row(client):
    cid, sid = await campaign(client)
    preview = (await import_csv(client, cid, sid, dry_run=True)).json()
    assert preview["consent_by_column"] and preview["consented"] == 3  # oui, oui, x
    assert preview["columns"]["consentement"] == "consent"
    done = (await import_csv(client, cid, sid, consent=False)).json()
    assert done["created"] == 4 and done["consented"] == 3
    listed = (await client.get(f"{API}/prospects?limit=50")).json()["items"]
    consent = {p["first_name"]: p["consent_status"] for p in listed}
    assert consent == {
        "Alice": "granted",
        "Bruno": "unknown",
        "Chloé": "granted",
        "David": "granted",
    }


async def test_without_column_the_import_checkbox_applies_to_every_row(client):
    cid, sid = await campaign(client)
    text = "prénom;email\nEmma;emma@demo.example.com\nFred;fred@demo.example.com\n"
    done = (await import_csv(client, cid, sid, text, consent=True)).json()
    assert not done["consent_by_column"] and done["consented"] == 2


async def test_first_contacts_are_prepared_only_for_eligible_people(
    client,
    mongo_db,
    session_factory,
    env,  # noqa: F811
):
    cid, sid = await campaign(client)
    await import_csv(client, cid, sid)
    preview = (await client.get(f"{API}/campaigns/{cid}/first-contacts")).json()
    # Alice et David : consentement et email ; Bruno : sans consentement ; Chloé : sans email.
    assert preview["eligible"] == 2 and preview["without_consent"] == 1
    assert preview["without_email"] == 1 and preview["campaign_active"]

    prepared = (await client.post(f"{API}/campaigns/{cid}/first-contacts")).json()
    assert prepared["queued"] == 2
    again = (await client.get(f"{API}/campaigns/{cid}/first-contacts")).json()
    assert again["eligible"] == 0 and again["in_progress"] == 2  # pas de doublon en file
    assert (await client.post(f"{API}/campaigns/{cid}/first-contacts")).json()["queued"] == 0

    await process_queue(mongo_db, session_factory, env)
    todo = (await client.get(f"{API}/todo?kind=first_contact")).json()
    assert todo["counts"]["first_contact"] == 2 and "validation" not in todo["counts"]
    item = todo["items"][0]
    assert item["title"] == "Premier contact à valider" and item["draft"]["content"]
    done = (await client.get(f"{API}/campaigns/{cid}/first-contacts")).json()
    assert done["eligible"] == 0 and done["already_contacted"] == 2


async def test_inactive_campaign_and_emergency_stop_prepare_nothing(client, mongo_db):
    cid, sid = await campaign(client, status="draft")
    await import_csv(client, cid, sid)
    refused = await client.post(f"{API}/campaigns/{cid}/first-contacts")
    assert refused.status_code == 409 and "Activez la campagne" in refused.json()["detail"]
    active, source = await campaign(client)
    await import_csv(client, active, source, CSV.replace("demo.example", "autre.example"))
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    stopped = await client.post(f"{API}/campaigns/{active}/first-contacts")
    assert stopped.status_code == 409 and "arrêt d'urgence" in stopped.json()["detail"]


async def test_advisor_only_prepares_first_contacts_in_their_scope(client, make_client):
    cid, sid = await campaign(client)
    await import_csv(client, cid, sid)
    other = await make_client(UserRole.ADVISOR)  # ni responsable ni affecté
    assert (await other.get(f"{API}/campaigns/{cid}/first-contacts")).json()["eligible"] == 0
    assert (await other.post(f"{API}/campaigns/{cid}/first-contacts")).json()["queued"] == 0
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.post(f"{API}/campaigns/{cid}/first-contacts")).status_code == 403


async def test_reviewed_first_contacts_are_approved_together(
    client,
    mongo_db,
    session_factory,
    env,  # noqa: F811
):
    cid, sid = await campaign(client)
    await import_csv(client, cid, sid)
    await client.post(f"{API}/campaigns/{cid}/first-contacts")
    await process_queue(mongo_db, session_factory, env)
    items = (await client.get(f"{API}/todo?kind=first_contact")).json()["items"]
    refs = [
        {"conversation_id": i["conversation_id"], "message_id": i["draft"]["message_id"]}
        for i in items
    ]
    bogus = {"conversation_id": items[0]["conversation_id"], "message_id": "absent"}
    result = (
        await client.post(f"{API}/todo/first-contacts/approve", json={"drafts": [*refs, bogus]})
    ).json()
    assert result == {"approved": 2, "skipped": 1}
    assert (await client.get(f"{API}/todo?kind=first_contact")).json()["total"] == 0
    # Une seconde validation des mêmes brouillons ne fait rien.
    again = await client.post(f"{API}/todo/first-contacts/approve", json={"drafts": refs})
    assert again.json() == {"approved": 0, "skipped": 2}


async def test_an_ordinary_reply_cannot_be_approved_in_a_batch(client, mongo_db):
    doc = await mongo_db[conversations.COLLECTION].insert_one(
        {
            "prospect_id": 1,
            "channel": "email",
            "status": "open",
            "messages": [
                {
                    "id": "d1",
                    "role": "agent",
                    "content": "Réponse",
                    "created_at": datetime.now(UTC),
                    "metadata": {"delivery": "draft", "draft": {"status": "pending"}},
                }
            ],
        }
    )
    ref = {"conversation_id": str(doc.inserted_id), "message_id": "d1"}
    result = await client.post(f"{API}/todo/first-contacts/approve", json={"drafts": [ref]})
    assert result.json() == {"approved": 0, "skipped": 1}


# --- Envoi étalé ---


async def _approved_first_contacts(mongo_db, count):
    for n in range(count):
        await mongo_db[conversations.COLLECTION].insert_one(
            {
                "prospect_id": 1000 + n,
                "channel": "email",
                "status": "open",
                "messages": [
                    {
                        "id": f"m{n}",
                        "role": "agent",
                        "content": "Bonjour, premier message.",
                        "created_at": datetime.now(UTC),
                        "metadata": {
                            "delivery": "draft",
                            "draft": {"status": "pending"},
                            "first_contact": True,
                        },
                    }
                ],
            }
        )
    async for doc in mongo_db[conversations.COLLECTION].find({}):
        await drafts.approve(mongo_db, str(doc["_id"]), doc["messages"][0]["id"], 1, None)


def _settings(**over) -> Settings:
    return Settings(
        _env_file=None,
        email_enabled=True,
        email_username="agent@datum.test",
        email_send_enabled=True,
        **over,
    )


async def test_first_contacts_are_spread_and_wait_for_the_send_window(
    session_factory, mongo_db, monkeypatch
):
    await _approved_first_contacts(mongo_db, 7)
    attempted: list[str] = []

    async def fake_deliver(factory, db, client, settings, doc, message, report):
        attempted.append(message["id"])

    monkeypatch.setattr(email_sync, "_deliver_one", fake_deliver)
    monkeypatch.setattr(email_sync, "in_send_window", lambda now, settings: False)
    closed = await email_sync.deliver_outbox(
        session_factory, mongo_db, FakeEmailClient(), _settings()
    )
    assert attempted == [] and closed.skipped == 7
    assert "premiers contacts en attente de la fenêtre d'envoi" in closed.notes

    monkeypatch.setattr(email_sync, "in_send_window", lambda now, settings: True)
    report = await email_sync.deliver_outbox(
        session_factory, mongo_db, FakeEmailClient(), _settings()
    )
    assert len(attempted) == email_sync.FIRST_CONTACTS_PER_CYCLE == 5
    assert report.skipped == 2 and "premiers contacts étalés" in " ".join(report.notes)
