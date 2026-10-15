"""API d'administration de la base de connaissances : documents, recherche, droits."""

import pytest
from app.api.dependencies import get_embeddings
from app.main import app
from app.models.enums import UserRole

from .fakes import HashEmbeddings

API = "/api/v1/knowledge"
DOC = """---
title: Programme Test
target: ebihar_students
---
## Durée
Le programme dure 18 mois en alternance.

## Admission
Il faut un Bac+2 minimum et passer un entretien de motivation.
"""


@pytest.fixture
def embeddings(client):
    emb = HashEmbeddings()
    app.dependency_overrides[get_embeddings] = lambda: emb
    return emb


async def put(client, slug="prog-test", content=DOC):
    return await client.put(f"{API}/documents/{slug}", json={"content": content})


async def test_status_reports_the_model_and_threshold(client, embeddings):
    body = (await client.get(f"{API}/status")).json()
    assert body["configured"] is True and body["embedding_model"] == "fake/hash-768"
    assert 0 < body["min_score"] <= 1 and body["top_k"] >= 1


async def test_without_a_key_status_says_so_and_writes_are_refused(client):
    app.dependency_overrides[get_embeddings] = lambda: None
    assert (await client.get(f"{API}/status")).json()["configured"] is False
    refused = await put(client)
    assert refused.status_code == 503 and "GEMINI_API_KEY" in refused.json()["detail"]
    assert (await client.post(f"{API}/search", json={"query": "durée"})).status_code == 503


async def test_create_read_update_and_delete_a_document(client, embeddings):
    created = await put(client)
    assert created.status_code == 200
    assert created.json() == {"slug": "prog-test", "status": "créé", "chunks": 2}
    assert (await put(client)).json()["status"] == "inchangé"
    assert (await put(client, content=DOC.replace("18", "24"))).json()["status"] == "mis à jour"

    listing = (await client.get(f"{API}/documents")).json()
    assert [(d["slug"], d["chunks"], d["needs_reindex"]) for d in listing] == [
        ("prog-test", 2, False)
    ]
    detail = (await client.get(f"{API}/documents/prog-test")).json()
    assert detail["title"] == "Programme Test" and detail["target_code"] == "ebihar_students"
    assert "24 mois" in detail["source_text"]
    assert [s["heading"] for s in detail["sections"]] == ["Durée", "Admission"]

    assert (await client.delete(f"{API}/documents/prog-test")).status_code == 204
    assert (await client.get(f"{API}/documents/prog-test")).status_code == 404
    assert (await client.delete(f"{API}/documents/prog-test")).status_code == 404


async def test_invalid_documents_and_slugs_are_rejected(client, embeddings):
    bad = await put(client, content="pas d'en-tête, juste du texte sans titre")
    assert bad.status_code == 422 and "title" in bad.json()["detail"]
    assert (await put(client, slug="Mauvais Slug")).status_code == 422
    assert (await client.put(f"{API}/documents/x", json={"content": "court"})).status_code == 422


async def test_search_shows_scores_and_the_threshold_verdict(client, embeddings):
    await put(client)
    found = (
        await client.post(
            f"{API}/search",
            json={"query": "Combien de temps dure le programme en alternance ?"},
        )
    ).json()
    top = found["results"][0]
    assert "18 mois" in top["text"] and top["retained"] is True
    assert top["score"] >= found["threshold"]
    off = (await client.post(f"{API}/search", json={"query": "recette de pizza maison"})).json()
    assert all(not r["retained"] for r in off["results"])


async def test_only_administrators_can_change_the_knowledge_base(client, embeddings, make_client):
    await put(client)
    for role in (UserRole.ADVISOR, UserRole.VIEWER):
        other = await make_client(role)
        assert (await put(other, slug="autre")).status_code == 403
        assert (await other.delete(f"{API}/documents/prog-test")).status_code == 403
        assert (await other.post(f"{API}/reindex")).status_code == 403
        assert (await other.get(f"{API}/documents")).status_code == 200  # lecture ouverte
        found = await other.post(f"{API}/search", json={"query": "durée du programme"})
        assert found.status_code == 200  # tester une question est permis


async def test_reindex_after_a_model_change(client, embeddings):
    await put(client)

    class NewModel(HashEmbeddings):
        model_id = "fake/nouveau-modele"

    new = NewModel()
    app.dependency_overrides[get_embeddings] = lambda: new
    assert (await client.get(f"{API}/documents")).json()[0]["needs_reindex"] is True
    assert (await client.post(f"{API}/reindex")).json() == {"documents": 1}
    doc = (await client.get(f"{API}/documents")).json()[0]
    assert doc["needs_reindex"] is False and doc["embedding_model"] == "fake/nouveau-modele"
