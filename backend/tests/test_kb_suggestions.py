"""Questions sans réponse : un conseiller propose la réponse, un administrateur la valide (D-50)."""

import pytest
from app.api.dependencies import get_embeddings
from app.main import app
from app.models.enums import UserRole
from app.services import conversations
from app.services.kb_suggestions import clean_answer, merge_section

from .fakes import HashEmbeddings

API = "/api/v1"
SUG = f"{API}/knowledge/suggestions"
QUESTION = "Est-ce que la formation est éligible au CPF ?"
ANSWER = "Oui, le programme eBIHAR est éligible au CPF pour les salariés."


@pytest.fixture
def embeddings(client):
    emb = HashEmbeddings()
    app.dependency_overrides[get_embeddings] = lambda: emb
    return emb


async def gap(client, session_factory, mongo_db, *, target="ebihar_students"):
    prospect = await client.post(
        f"{API}/prospects", json={"email": "cpf@demo.example.com", "channel": "email"}
    )
    prospect_id = prospect.json()["prospect"]["id"]
    opened = await client.post(
        f"{API}/conversations", json={"prospect_id": prospect_id, "channel": "email"}
    )
    conversation_id = opened.json()["conversation"]["id"]
    await conversations.set_handoff(
        mongo_db,
        conversation_id,
        {
            "reason": "question_hors_base",
            "summary": "Question sur le CPF",
            "pending_question": QUESTION,
            "recommended_action": "Répondre",
            "target_code": target,
        },
    )
    return conversation_id


async def test_prefill_offers_the_question_the_advisor_reply_and_the_programme(
    client, session_factory, mongo_db
):
    conv = await gap(client, session_factory, mongo_db)
    empty = (await client.get(f"{SUG}/prefill", params={"conversation_id": conv})).json()
    assert empty["question"] == QUESTION and empty["answer"] == ""
    assert empty["target_code"] == "ebihar_students" and empty["existing"] is None
    sent = await client.post(
        f"{API}/conversations/{conv}/messages", json={"role": "advisor", "content": ANSWER}
    )
    assert sent.status_code == 201
    filled = (await client.get(f"{SUG}/prefill", params={"conversation_id": conv})).json()
    assert filled["answer"] == ANSWER


async def test_advisor_proposes_admin_approves_and_the_faq_answers(
    client, session_factory, mongo_db, make_client, embeddings
):
    conv = await gap(client, session_factory, mongo_db)
    advisor = await make_client(UserRole.ADVISOR)
    body = {"conversation_id": conv, "question": QUESTION, "answer": ANSWER,
            "target_code": "ebihar_students"}  # fmt: skip
    # Le conseiller ne voit que son périmètre : prospect sans campagne, donc invisible pour lui.
    assert (await advisor.post(SUG, json=body)).status_code == 404
    proposed = await client.post(SUG, json=body)
    assert proposed.status_code == 201
    sid = proposed.json()["id"]
    assert proposed.json()["status"] == "pending"
    assert (await client.post(SUG, json=body)).status_code == 409  # une seule en attente

    # Rien dans la base avant validation.
    assert (await client.get(f"{API}/knowledge/documents")).json() == []
    pending = (await client.get(SUG, params={"status": "pending"})).json()
    assert pending["total"] == 1 and pending["items"][0]["prospect_question"] == QUESTION

    assert (await advisor.post(f"{SUG}/{sid}/approve", json={})).status_code == 403
    approved = await client.post(
        f"{SUG}/{sid}/approve", json={"answer": ANSWER + " Le dossier se monte en ligne."}
    )
    assert approved.status_code == 200, approved.text
    done = approved.json()
    assert done["status"] == "approved"
    assert done["document_slug"] == "questions-prospects-ebihar_students"
    assert (await client.post(f"{SUG}/{sid}/approve", json={})).status_code == 409

    doc = (await client.get(f"{API}/knowledge/documents/{done['document_slug']}")).json()
    assert doc["title"] == "Questions des prospects — Étudiants eBIHAR"
    assert doc["target_code"] == "ebihar_students"
    assert [s["heading"] for s in doc["sections"]] == [QUESTION]
    found = (await client.post(f"{API}/knowledge/search", json={"query": QUESTION})).json()[
        "results"
    ][0]
    assert "éligible au CPF" in found["text"]

    # Même question validée de nouveau : la section est remplacée, pas dupliquée.
    again = await client.post(SUG, json={**body, "answer": "Oui, éligible CPF et OPCO."})
    await client.post(f"{SUG}/{again.json()['id']}/approve", json={})
    doc = (await client.get(f"{API}/knowledge/documents/{done['document_slug']}")).json()
    assert len(doc["sections"]) == 1 and "OPCO" in doc["sections"][0]["text"]


async def test_admin_can_move_an_answer_to_the_common_faq(
    client, session_factory, mongo_db, embeddings
):
    conv = await gap(client, session_factory, mongo_db)
    sid = (
        await client.post(
            SUG,
            json={
                "conversation_id": conv,
                "question": QUESTION,
                "answer": ANSWER,
                "target_code": "ebihar_students",
            },  # fmt: skip
        )
    ).json()["id"]
    done = (await client.post(f"{SUG}/{sid}/approve", json={"target_code": None})).json()
    assert done["document_slug"] == "questions-prospects" and done["target_code"] is None
    doc = (await client.get(f"{API}/knowledge/documents/questions-prospects")).json()
    assert doc["title"] == "Questions des prospects" and doc["target_code"] is None


async def test_reject_keeps_the_base_unchanged(client, session_factory, mongo_db, embeddings):
    conv = await gap(client, session_factory, mongo_db, target=None)
    sid = (
        await client.post(
            SUG, json={"conversation_id": conv, "question": QUESTION, "answer": ANSWER}
        )  # fmt: skip
    ).json()["id"]
    rejected = await client.post(f"{SUG}/{sid}/reject", json={"reason": "Réponse à vérifier"})
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["reason"] == "Réponse à vérifier"
    assert (await client.post(f"{SUG}/{sid}/approve", json={})).status_code == 409
    assert (await client.get(f"{API}/knowledge/documents")).json() == []
    # Après un refus, une nouvelle proposition est possible.
    retry = await client.post(
        SUG, json={"conversation_id": conv, "question": QUESTION, "answer": ANSWER}
    )
    assert retry.status_code == 201


async def test_approval_needs_embeddings_and_leaves_the_proposal_pending(
    client, session_factory, mongo_db
):
    app.dependency_overrides[get_embeddings] = lambda: None
    conv = await gap(client, session_factory, mongo_db)
    sid = (
        await client.post(
            SUG, json={"conversation_id": conv, "question": QUESTION, "answer": ANSWER}
        )  # fmt: skip
    ).json()["id"]
    assert (await client.post(f"{SUG}/{sid}/approve", json={})).status_code == 503
    assert (await client.get(SUG, params={"status": "pending"})).json()["total"] == 1


async def test_unknown_programme_and_viewer_writes_are_refused(
    client, session_factory, mongo_db, make_client
):
    conv = await gap(client, session_factory, mongo_db)
    bad = await client.post(
        SUG,
        json={
            "conversation_id": conv,
            "question": QUESTION,
            "answer": ANSWER,
            "target_code": "inconnu",
        },  # fmt: skip
    )
    assert bad.status_code == 422
    viewer = await make_client(UserRole.VIEWER)
    refused = await viewer.post(
        SUG, json={"conversation_id": conv, "question": QUESTION, "answer": ANSWER}
    )
    assert refused.status_code == 403
    assert (await viewer.get(SUG)).status_code == 200


def test_answers_cannot_open_new_sections():
    assert clean_answer("Oui.\n## Autre titre\nTexte") == "Oui.\nAutre titre\nTexte"


def test_merge_section_appends_then_replaces():
    first = merge_section(None, "FAQ", None, "Q1 ?", "R1")
    assert first.startswith("---\ntitle: FAQ\ntarget: all\n---\n")
    both = merge_section(first, "FAQ", None, "Q2 ?", "R2")
    assert both.count("## ") == 2
    replaced = merge_section(both, "FAQ", None, "q1 ?", "R1 bis")
    assert "R1 bis" in replaced and "\nR1\n" not in replaced and "## Q2 ?\nR2" in replaced


async def test_erasure_drops_pending_proposals_and_unlinks_approved_ones(
    client, session_factory, mongo_db, embeddings
):
    from app.services import erasure

    conv = await gap(client, session_factory, mongo_db)
    body = {"conversation_id": conv, "question": QUESTION, "answer": ANSWER}
    sid = (await client.post(SUG, json=body)).json()["id"]
    await client.post(f"{SUG}/{sid}/approve", json={})
    await client.post(SUG, json={**body, "question": "Autre question du prospect ?"})
    prospect_id = (await conversations.get_doc(mongo_db, conv))["prospect_id"]
    async with session_factory() as session:
        await erasure.erase_prospect(
            session, mongo_db, prospect_id, reason="request", actor_id=None
        )
    left = [d async for d in mongo_db["kb_suggestions"].find({})]
    assert len(left) == 1 and left[0]["status"] == "approved"
    assert "prospect_id" not in left[0] and "prospect_question" not in left[0]
