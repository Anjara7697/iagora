"""Mode assisté : brouillons de l'agent à valider, « À traiter » et arrêt d'urgence."""

import pytest
from app.graph.ports import Passage
from app.graph.state import Qualification
from app.models.enums import UserRole
from app.services import agent_settings
from app.services.agent_settings import AgentMode

from .test_agent_workflow import conversation, lead, run
from .test_agent_workflow import env as env  # noqa: F401  (fixture)

API = "/api/v1"


@pytest.fixture
async def assisted(env, mongo_db):  # noqa: F811
    """Le réglage par défaut de l'application : mode assisté."""
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    return env


async def draft_of(client, cid):
    conv = await conversation(client, cid)
    return next(m for m in conv["messages"] if m["role"] == "agent")


async def todo(client, **params):
    return (await client.get(f"{API}/todo", params=params)).json()


async def test_default_mode_is_assisted(client, mongo_db):
    assert await agent_settings.get_mode(mongo_db) is AgentMode.ASSISTED
    assert (await client.get(f"{API}/agent/mode")).json()["mode"] == "assisted"


async def test_agent_reply_is_a_draft_that_blocks_a_second_run(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour, des infos ?")
    assert (await run(client, cid)).status_code == 201
    message = await draft_of(client, cid)
    assert message["metadata"]["delivery"] == "draft"
    assert message["metadata"]["draft"]["status"] == "pending"
    again = await run(client, cid)
    assert again.status_code == 409 and "brouillon" in again.json()["detail"]


async def test_todo_lists_the_draft_with_sources_and_priority(client, assisted):
    assisted.kb.passages = [Passage(source="Programme eBIHAR / Durée", text="Il dure 18 mois.")]
    assisted.llm.qualification = Qualification(intent="question")
    assisted.llm.reply = "Le programme dure 18 mois."
    pid, mid, cid = await lead(client, "Combien de temps dure le programme ?")
    await run(client, cid)

    page = await todo(client)
    assert page["total"] == 1 and page["counts"] == {"validation": 1}
    item = page["items"][0]
    assert item["kind"] == "validation" and item["priority"] == "low"  # prospect froid
    assert item["prospect"]["first_name"] == "Jean"
    assert item["draft"]["content"] == "Le programme dure 18 mois."
    assert item["draft"]["sources"] == ["Programme eBIHAR / Durée"]
    assert item["recommendation"]["risk"] == "low"
    assert (await todo(client, kind="escalation"))["total"] == 0


async def test_approve_with_edit_keeps_the_original_and_empties_the_queue(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = await draft_of(client, cid)
    url = f"{API}/conversations/{cid}/drafts/{draft['id']}/approve"
    ok = await client.post(url, json={"content": "Bonjour Jean, version relue par un conseiller."})
    assert ok.status_code == 200
    body = ok.json()
    assert body["content"] == "Bonjour Jean, version relue par un conseiller."
    assert body["metadata"]["draft"]["status"] == "approved"
    assert body["metadata"]["draft"]["edited"] is True
    assert (
        body["metadata"]["draft"]["original_content"] == "Bonjour Jean, merci pour votre message."
    )
    assert (
        body["metadata"]["delivery"] == "not_sent"
    )  # validé ; l'envoi viendra avec les connecteurs
    assert (await todo(client))["total"] == 0
    assert (await client.post(url, json={})).status_code == 409  # déjà traité


async def test_reject_needs_a_reason_and_frees_the_thread(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = await draft_of(client, cid)
    url = f"{API}/conversations/{cid}/drafts/{draft['id']}/reject"
    assert (await client.post(url, json={"reason": ""})).status_code == 422
    rejected = await client.post(url, json={"reason": "Ton trop familier"})
    assert rejected.json()["metadata"]["draft"]["status"] == "rejected"
    assert rejected.json()["metadata"]["draft"]["reason"] == "Ton trop familier"
    assert (await todo(client))["total"] == 0
    assert (await run(client, cid)).status_code == 201  # l'agent peut répondre à nouveau


async def test_regenerate_supersedes_the_draft_with_a_new_one(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    first = await draft_of(client, cid)
    assisted.llm.reply = "Bonjour Jean, voici une seconde version."
    r = await client.post(f"{API}/conversations/{cid}/drafts/{first['id']}/regenerate")
    assert r.status_code == 201
    messages = (await conversation(client, cid))["messages"]
    statuses = [m["metadata"]["draft"]["status"] for m in messages if m["role"] == "agent"]
    assert statuses == ["superseded", "pending"]
    assert (await todo(client))["items"][0]["draft"][
        "content"
    ] == "Bonjour Jean, voici une seconde version."


async def test_viewer_cannot_decide_on_drafts(client, assisted, make_client):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = await draft_of(client, cid)
    viewer = await make_client(UserRole.VIEWER)
    base = f"{API}/conversations/{cid}/drafts/{draft['id']}"
    assert (await viewer.post(f"{base}/approve", json={})).status_code == 403
    assert (await viewer.post(f"{base}/reject", json={"reason": "non"})).status_code == 403
    assert (await viewer.get(f"{API}/todo")).status_code == 200  # il peut consulter


async def test_opt_out_cancels_pending_drafts_and_blocks_approval(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = await draft_of(client, cid)
    await client.post(f"{API}/prospects/{pid}/opt-out", json={"source": "test"})
    assert (await draft_of(client, cid))["metadata"]["draft"]["status"] == "cancelled"
    assert (await todo(client))["total"] == 0
    r = await client.post(f"{API}/conversations/{cid}/drafts/{draft['id']}/approve", json={})
    assert r.status_code == 409


async def test_handoff_notice_is_direct_and_the_handoff_enters_the_queue(client, assisted):
    pid, mid, cid = await lead(client, "Je vais porter plainte contre votre école.")
    await run(client, cid)
    notice = await draft_of(client, cid)
    assert notice["metadata"]["delivery"] == "not_sent" and "draft" not in notice["metadata"]
    page = await todo(client)
    assert page["counts"] == {"escalation": 1}
    item = page["items"][0]
    assert item["priority"] == "critical" and item["handoff"]["reason"] == "situation_sensible"


async def test_unknown_question_is_a_knowledge_gap(client, assisted):
    pid, mid, cid = await lead(client, "Le diplôme est-il reconnu par l'État ?")
    assisted.llm.qualification = Qualification(intent="question")
    await run(client, cid)
    page = await todo(client)
    assert page["counts"] == {"kb_gap": 1}
    assert page["items"][0]["priority"] == "medium"
    assert "reconnu" in page["items"][0]["detail"]


async def test_emergency_stop_blocks_the_agent_and_rules_on_who_can_switch(
    client, assisted, make_client
):
    pid, mid, cid = await lead(client, "Bonjour")
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.put(f"{API}/agent/mode", json={"mode": "manual"})).status_code == 200
    stopped = await run(client, cid)
    assert stopped.status_code == 409 and "manuel" in stopped.json()["detail"]
    # un conseiller ne peut pas désactiver la validation ; un administrateur le peut
    assert (await advisor.put(f"{API}/agent/mode", json={"mode": "auto"})).status_code == 403
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.put(f"{API}/agent/mode", json={"mode": "assisted"})).status_code == 403
    assert (await advisor.put(f"{API}/agent/mode", json={"mode": "assisted"})).status_code == 200
    assert (await run(client, cid)).status_code == 201
    assert (await client.put(f"{API}/agent/mode", json={"mode": "auto"})).json()["mode"] == "auto"
