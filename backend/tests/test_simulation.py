"""Parcours HTTP guidé : graphe réel, modèle scripté pour la régression, zéro transport."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from app.agents.auto import run_due_follow_ups
from app.api.dependencies import get_language_model
from app.config import get_settings
from app.devtools import simulation
from app.devtools.fakes import FakeCalendar, FakeKnowledge, FakeLLM
from app.graph.state import Qualification
from app.main import app
from app.models import FollowUp
from app.models.enums import FollowUpStatus, UserRole
from app.services import agent_settings, conversations, follow_ups
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError
from sqlalchemy import select


@pytest.fixture
async def model(client):
    llm = FakeLLM(
        Qualification(intent="question"), reply="Le programme dure 18 mois en alternance."
    )
    app.dependency_overrides[get_language_model] = lambda: llm
    return llm


async def start(client):
    response = await client.post("/api/v1/simulation/sessions", json={"first_name": "Camille"})
    assert response.status_code == 201, response.text
    return response.json()


async def send(client, cid, text, key):
    return await client.post(
        f"/api/v1/simulation/{cid}/messages",
        json={
            "content": text,
            "external_message_id": key,
        },
    )


async def approve(client, cid):
    conv = (await client.get(f"/api/v1/conversations/{cid}")).json()
    pending = next(
        m for m in conv["messages"] if m["metadata"].get("draft", {}).get("status") == "pending"
    )
    response = await client.post(f"/api/v1/simulation/{cid}/drafts/{pending['id']}/approve")
    assert response.status_code == 200, response.text
    return response.json()


async def test_complete_guided_journey_memory_delivery_and_booking(client, model, session_factory):
    s = await start(client)
    cid = s["conversation_id"]
    steps = [
        (
            Qualification(intent="question", goal="devenir data analyst"),
            "Le programme dure 18 mois en alternance.",
        ),
        (
            Qualification(intent="interested", study_level="Bac+3", field_of_study="informatique"),
            "Merci pour ces précisions. Avez-vous des questions sur l’alternance ?",
        ),
        (
            Qualification(intent="question"),
            "Un conseiller accompagne la recherche d’entreprise et la préparation du CV, "
            "sans garantir de contrat.",
        ),
        (Qualification(intent="meeting_request"), ""),
        (Qualification(intent="slot_choice", chosen_slot=2), ""),
    ]
    for i, (qualification, reply) in enumerate(steps):
        model.qualification, model.reply = qualification, reply
        result = await send(client, cid, s["guide"][i], f"turn-{i}")
        assert result.status_code == 200, result.text
        before = result.json()["exchange"]["messages"]
        assert before[-1]["role"] == "prospect"  # le brouillon ne fuit jamais
        report = await approve(client, cid)
        assert report["exchange"]["messages"][-1]["role"] == "agent"
    p = (await client.get(f"/api/v1/prospects/{s['prospect_id']}")).json()
    assert p["profile"]["study_level"] == "Bac+3"
    assert p["profile"]["goal"] == "devenir data analyst"
    assert p["campaigns"][0]["conversion_stage"] == "meeting_scheduled"
    assert len(report["appointments"]) == 1
    assert report["appointments"][0]["simulated"] is True
    assert "zoom.example" in report["appointments"][0]["meeting_url"]
    assert all(
        set(m) == {"id", "role", "content", "created_at"} for m in report["exchange"]["messages"]
    )
    # Rejeu n8n du dernier message : ni doublon de message, ni nouveau rendez-vous.
    again = await send(client, cid, s["guide"][-1], "turn-4")
    assert again.status_code == 200
    assert len(again.json()["appointments"]) == 1
    assert len(again.json()["exchange"]["messages"]) == 10


async def test_pending_draft_stop_and_replay(client, model):
    s = await start(client)
    cid = s["conversation_id"]
    assert (await send(client, cid, s["guide"][0], "one")).status_code == 200
    blocked = await send(client, cid, "Je souhaite poursuivre", "two")
    assert blocked.status_code == 409
    assert (await send(client, cid, "STOP, ne m’écrivez plus", "stop")).status_code == 200
    view = (await client.get(f"/api/v1/simulation/{cid}/exchange")).json()
    assert all(m["role"] == "prospect" for m in view["messages"])
    assert view["status"] == "open"  # la désinscription ne falsifie pas le statut métier
    assert view["can_continue"] is False
    assert (await send(client, cid, "Encore une question", "after-stop")).status_code == 409
    p = (await client.get(f"/api/v1/prospects/{s['prospect_id']}")).json()
    assert p["consent_status"] == "opted_out"
    assert (await client.post(f"/api/v1/simulation/{cid}/run")).status_code == 200
    assert (await send(client, cid, "STOP, ne m’écrivez plus", "stop")).status_code == 200


async def test_auto_mode_idempotence_and_manual_pause(client, model, mongo_db):
    await agent_settings.set_mode(mongo_db, AgentMode.AUTO, None)
    s = await start(client)
    cid = s["conversation_id"]
    first = await send(client, cid, s["guide"][0], "same")
    assert first.status_code == 200
    assert len(first.json()["exchange"]["messages"]) == 2
    calls = len(model.extract_calls)
    replay = await send(client, cid, s["guide"][0], "same")
    assert replay.status_code == 200 and len(model.extract_calls) == calls
    conflict = await send(client, cid, "Message différent", "same")
    assert conflict.status_code == 409
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    paused = await send(client, cid, "Bonjour à nouveau", "new")
    assert paused.status_code == 409
    assert len(model.extract_calls) == calls
    await agent_settings.set_mode(mongo_db, AgentMode.AUTO, None)
    resumed = await client.post(f"/api/v1/simulation/{cid}/run")
    assert resumed.status_code == 200
    assert len(resumed.json()["exchange"]["messages"]) == 4


async def test_no_real_worker_or_generic_runtime_for_guided_session(
    client, model, session_factory, mongo_db
):
    s = await start(client)
    cid = s["conversation_id"]
    generic = await client.post("/api/v1/agent/runs", json={"conversation_id": cid})
    assert generic.status_code == 409 and not model.extract_calls
    async with session_factory() as session:
        p = (await client.get(f"/api/v1/prospects/{s['prospect_id']}")).json()
        mid = p["campaigns"][0]["id"]
        await follow_ups.schedule_follow_up(
            session, s["prospect_id"], mid, "email", timedelta(days=-1), "test"
        )
    now = datetime(2026, 10, 19, 12, tzinfo=UTC)
    summary = await run_due_follow_ups(
        session_factory,
        mongo_db,
        llm=model,
        calendar=FakeCalendar(),
        knowledge=FakeKnowledge(),
        settings=get_settings(),
        now=now + timedelta(days=365),
    )
    assert summary.executed == 0 and not model.extract_calls
    async with session_factory() as session:
        statuses = list(
            await session.scalars(
                select(FollowUp.status).where(FollowUp.prospect_id == s["prospect_id"])
            )
        )
        assert statuses == [FollowUpStatus.SCHEDULED]


async def test_dispatch_is_concurrent_safe_and_stopped_in_manual(
    client, model, session_factory, mongo_db
):
    s = await start(client)
    cid = s["conversation_id"]
    await send(client, cid, s["guide"][0], "one")
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    report = await approve(client, cid)
    assert len(report["exchange"]["messages"]) == 1
    await agent_settings.set_mode(mongo_db, AgentMode.AUTO, None)

    async def deliver():
        async with session_factory() as session:
            await simulation.dispatch(session, mongo_db, cid)

    results = await asyncio.gather(deliver(), deliver(), return_exceptions=True)
    assert all(result is None or isinstance(result, ConflictError) for result in results)
    view = (await client.get(f"/api/v1/simulation/{cid}/exchange")).json()
    assert len(view["messages"]) == 2


async def test_simulation_rejects_real_conversation(client, model, session_factory, mongo_db):
    s = await start(client)
    doc = await conversations.get_doc(mongo_db, s["conversation_id"])
    await mongo_db[conversations.COLLECTION].update_one(
        {"_id": doc["_id"]}, {"$unset": {"simulation": ""}}
    )
    response = await client.post(f"/api/v1/simulation/{s['conversation_id']}/run")
    assert response.status_code == 404 and not model.extract_calls


async def test_production_and_viewer_are_denied(client, model, make_client):
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.post("/api/v1/simulation/sessions", json={})).status_code == 403
    settings = get_settings().model_copy(update={"environment": "production"})
    app.dependency_overrides[get_settings] = lambda: settings
    assert (await client.post("/api/v1/simulation/sessions", json={})).status_code == 403


async def test_reject_then_regenerate_does_not_reveal_dead_draft(client, model):
    s = await start(client)
    cid = s["conversation_id"]
    await send(client, cid, s["guide"][0], "one")
    conv = (await client.get(f"/api/v1/conversations/{cid}")).json()
    mid = conv["messages"][-1]["id"]
    rejected = await client.post(
        f"/api/v1/conversations/{cid}/drafts/{mid}/reject", json={"reason": "Réponse à revoir"}
    )
    assert rejected.status_code == 200
    calls = len(model.extract_calls)
    regenerated = await client.post(f"/api/v1/simulation/{cid}/run")
    assert regenerated.status_code == 200 and len(model.extract_calls) == calls + 1
    assert len(regenerated.json()["exchange"]["messages"]) == 1
    approved = await approve(client, cid)
    assert len(approved["exchange"]["messages"]) == 2


async def test_simulated_delivery_is_never_selected_by_smtp(
    client, model, session_factory, mongo_db
):
    from app.devtools.fakes import FakeEmailClient
    from app.services.email_sync import deliver_outbox

    await agent_settings.set_mode(mongo_db, AgentMode.AUTO, None)
    s = await start(client)
    result = await send(client, s["conversation_id"], s["guide"][0], "one")
    assert result.status_code == 200
    mailbox = FakeEmailClient()
    settings = get_settings().model_copy(update={"email_send_enabled": True})
    report = await deliver_outbox(session_factory, mongo_db, mailbox, settings)
    assert report.sent == 0 and mailbox.sent == []


async def test_dispatch_after_todo_approval_does_not_generate_or_approve(
    client, model, mongo_db, session_factory
):
    from app.devtools.fakes import FakeEmailClient
    from app.services.email_sync import deliver_outbox

    s = await start(client)
    cid = s["conversation_id"]
    await send(client, cid, s["guide"][0], "one")
    calls = len(model.extract_calls)
    before = await client.post(f"/api/v1/simulation/{cid}/dispatch")
    assert before.status_code == 200 and len(before.json()["messages"]) == 1
    conv = (await client.get(f"/api/v1/conversations/{cid}")).json()
    mid = conv["messages"][-1]["id"]
    # Validation depuis la file ordinaire, comme un conseiller qui utilise À traiter.
    approved = await client.post(f"/api/v1/conversations/{cid}/drafts/{mid}/approve", json={})
    assert approved.status_code == 200
    # Le worker SMTP réel ne doit pas réclamer/bloquer ce message avant le polling n8n.
    mailbox = FakeEmailClient()
    await deliver_outbox(
        session_factory,
        mongo_db,
        mailbox,
        get_settings().model_copy(update={"email_send_enabled": True}),
    )
    assert mailbox.sent == []
    after = await client.post(f"/api/v1/simulation/{cid}/dispatch")
    assert after.status_code == 200 and len(after.json()["messages"]) == 2
    assert len(model.extract_calls) == calls
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    assert (await client.post(f"/api/v1/simulation/{cid}/dispatch")).status_code == 200
