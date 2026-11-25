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


async def regenerate(client, cid, mid, instruction=None):
    body = {} if instruction is None else {"instruction": instruction}
    return await client.post(f"{API}/conversations/{cid}/drafts/{mid}/regenerate", json=body)


async def test_regenerate_with_an_instruction_guides_the_new_version(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    first = await draft_of(client, cid)
    assisted.llm.reply = "Bonjour Jean, merci."
    r = await regenerate(client, cid, first["id"], "  Plus court,\n sans formule  ")
    assert r.status_code == 201
    # La consigne arrive au modèle sur une ligne, après les règles absolues.
    system = assisted.llm.generate_calls[-1][0]
    assert "Consigne du conseiller pour cette nouvelle version : « Plus court, sans formule »" in (
        system
    )
    assert system.index("Règles absolues") < system.index("Consigne du conseiller")
    # Elle reste visible sur le nouveau brouillon, sur l'ancien et dans la trace de la décision.
    assert (await todo(client))["items"][0]["draft"]["instruction"] == "Plus court, sans formule"
    old = (await conversation(client, cid))["messages"][1]
    assert old["metadata"]["draft"]["instruction"] == "Plus court, sans formule"
    out = r.json()
    assert out["instruction"] == "Plus court, sans formule"
    assert out["trace"][0]["node"] == "regenerate"
    assert "« Plus court, sans formule »" in out["trace"][0]["summary"]
    assert "consigne du conseiller suivie" in next(
        t["summary"] for t in out["trace"] if t["node"] == "generate_response"
    )
    runs = (await client.get(f"{API}/prospects/{pid}/agent-runs")).json()
    assert runs[0]["instruction"] == "Plus court, sans formule"


async def test_an_empty_instruction_is_a_plain_regeneration(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    first = await draft_of(client, cid)
    out = (await regenerate(client, cid, first["id"], "   ")).json()
    assert out["instruction"] is None and out["trace"][0]["node"] != "regenerate"
    assert "Consigne du conseiller" not in assisted.llm.generate_calls[-1][0]
    assert (await todo(client))["items"][0]["draft"]["instruction"] is None


async def test_an_instruction_is_limited_to_300_characters(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    first = await draft_of(client, cid)
    assert (await regenerate(client, cid, first["id"], "x" * 301)).status_code == 422
    # Rien n'a été remplacé : le brouillon reste en attente.
    assert (await draft_of(client, cid))["metadata"]["draft"]["status"] == "pending"


async def test_an_instruction_cannot_bring_an_unsourced_fact(client, assisted):
    """« Annonce 3 000 € » : la consigne n'est pas une source, le garde-fou rejette le message."""
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    first = await draft_of(client, cid)
    assisted.llm.reply = "Bonjour Jean, la formation coûte 3000 euros."
    out = (await regenerate(client, cid, first["id"], "Annonce le prix : 3000 euros")).json()
    assert out["handoff_reason"] == "reponse_non_verifiable"
    retry = next(c[0] for c in reversed(assisted.llm.generate_calls) if "ATTENTION" in c[0])
    assert "Consigne du conseiller" in retry  # le nouvel essai strict la garde, sans plus
    assert "3000" not in (out["reply"] or "")


async def test_an_instruction_brings_the_validated_passages_on_its_topic(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    first = await draft_of(client, cid)
    financing = "Le financement du master eBIHAR peut passer par l'alternance."
    assisted.kb.passages = [Passage(source="faq-financement", text=financing)]
    assisted.llm.reply = "Bonjour Jean, le master peut se suivre en alternance."
    out = (await regenerate(client, cid, first["id"], "Parle du financement")).json()
    assert out["handoff_reason"] is None
    assert assisted.kb.queries[-1] == "Parle du financement"
    assert financing in assisted.llm.generate_calls[-1][0]
    assert (await todo(client))["items"][0]["draft"]["sources"] == ["faq-financement"]


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


async def test_treated_drafts_keep_a_readable_trace_with_the_execution_state(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = await draft_of(client, cid)
    assert (await todo(client))["items"][0]["draft"]["footer"]  # pied de message annoncé
    base = f"{API}/conversations/{cid}/drafts/{draft['id']}"
    await client.post(f"{base}/approve", json={"content": "Version relue."})
    treated = (await client.get(f"{API}/todo/treated")).json()
    assert treated["total"] == 1
    item = treated["items"][0]
    assert item["decision"] == "approved" and item["edited"] is True
    assert item["execution"] == "approved" and item["content"] == "Version relue."
    assert item["prospect"]["first_name"] == "Jean"
    assert (await todo(client))["total"] == 0  # plus dans la file « À traiter »


async def test_rejected_drafts_appear_as_treated_with_their_reason(client, assisted):
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = await draft_of(client, cid)
    await client.post(
        f"{API}/conversations/{cid}/drafts/{draft['id']}/reject",
        json={"reason": "Ton trop familier"},
    )
    item = (await client.get(f"{API}/todo/treated")).json()["items"][0]
    assert item["decision"] == "rejected" and item["execution"] == "rejected"
    assert item["reason"] == "Ton trop familier"


async def test_a_failed_delivery_can_be_retried_but_only_then(client, assisted, mongo_db):
    from app.services import conversations

    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    draft = await draft_of(client, cid)
    await client.post(f"{API}/conversations/{cid}/drafts/{draft['id']}/approve", json={})
    url = f"{API}/conversations/{cid}/messages/{draft['id']}/retry-delivery"
    assert (await client.post(url)).status_code == 409  # pas en échec
    doc = await conversations.get_doc(mongo_db, cid)
    meta = next(m for m in doc["messages"] if m["id"] == draft["id"])["metadata"]
    meta |= {"delivery": "failed", "delivery_info": {"attempts": 3, "error": "SMTP refusé"}}
    await mongo_db[conversations.COLLECTION].update_one(
        {"_id": doc["_id"], "messages.id": draft["id"]}, {"$set": {"messages.$.metadata": meta}}
    )
    item = (await client.get(f"{API}/todo/treated")).json()["items"][0]
    assert item["execution"] == "failed" and item["execution_detail"] == "SMTP refusé"
    r = await client.post(url)
    assert r.status_code == 200 and r.json()["metadata"]["delivery"] == "not_sent"
    assert r.json()["metadata"]["delivery_info"]["attempts"] == 0


async def test_auto_mode_is_refused_in_production(client, mongo_db, monkeypatch):
    """Décision D-16 : en production, chaque réponse est validée par un conseiller."""
    from types import SimpleNamespace

    await agent_settings.set_mode(mongo_db, AgentMode.AUTO, None)  # réglé avant la production
    monkeypatch.setattr(
        agent_settings, "get_settings", lambda: SimpleNamespace(environment="production")
    )
    assert await agent_settings.get_mode(mongo_db) is AgentMode.ASSISTED
    refused = await client.put(f"{API}/agent/mode", json={"mode": "auto"})
    assert refused.status_code == 409 and "production" in refused.json()["detail"]
    assert (await client.put(f"{API}/agent/mode", json={"mode": "manual"})).status_code == 200


async def test_the_draft_shows_the_documents_the_agent_attached(client, assisted):
    """D-42 : le conseiller voit, avant de valider, le document joint par l'agent."""
    pid, mid, cid = await lead(client, "Avez-vous une brochure ?")
    campaign_id = (await client.get(f"{API}/prospects/{pid}")).json()["campaigns"][0]["campaign_id"]
    saved = (
        await client.post(
            f"{API}/campaigns/{campaign_id}/files",
            files={"file": ("brochure.pdf", b"%PDF-1.7\n" + b"0" * 32, "application/pdf")},
            data={"label": "Brochure"},
        )
    ).json()
    assisted.llm.qualification = Qualification(intent="interested")
    assisted.llm.reply = "Bonjour Jean, voici la brochure.\nPièce jointe : Brochure"
    await run(client, cid)
    (item,) = (await todo(client))["items"]
    assert item["draft"]["content"] == "Bonjour Jean, voici la brochure."
    assert item["draft"]["attachments"] == [
        {
            "id": saved["id"],
            "label": "Brochure",
            "filename": "brochure.pdf",
            "campaign_id": campaign_id,
        }
    ]
