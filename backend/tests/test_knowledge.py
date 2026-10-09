"""RAG : découpage, ingestion, recherche (seuil, programme, modèle, démo) et branchement agent.

Les embeddings sont des `HashEmbeddings` (déterministes, hors ligne) : on teste la mécanique, pas
la qualité sémantique d'un vrai modèle (mesurée à part par `kb-eval`).
"""

import json
from pathlib import Path

import pytest
from app.api.dependencies import get_knowledge_base
from app.devtools.commands import DEMO_KB_DIR
from app.graph.state import Qualification
from app.integrations.embeddings.base import EmbeddingError
from app.integrations.embeddings.factory import create_embeddings
from app.integrations.knowledge.chunking import DocumentFormatError, parse_document
from app.integrations.knowledge.pg_knowledge import PgKnowledgeBase
from app.main import app
from app.models import KnowledgeChunk, KnowledgeDocument
from app.services import knowledge
from app.services.knowledge import IngestStatus
from sqlalchemy import func, select

from .fakes import HashEmbeddings
from .test_agent_workflow import conversation, lead, run
from .test_agent_workflow import env as env  # noqa: F401  (fixture)

DOC = """---
title: Programme Test
target: prog_a
---
## Durée
Le programme dure 18 mois en alternance.

## Admission
Il faut un Bac+2 minimum et passer un entretien de motivation.
"""

GENERAL = """---
title: FAQ générale
---
## Rendez-vous
Un conseiller reçoit les candidats en visioconférence.
"""

OTHER = """---
title: Programme Autre
target: prog_b
---
## Durée
Le programme dure 6 mois le soir.
"""


# --- Découpage ---


def test_parse_splits_by_section_and_prefixes_context():
    doc = parse_document("test", DOC)
    assert doc.title == "Programme Test" and doc.target_code == "prog_a"
    assert [c.heading for c in doc.chunks] == ["Durée", "Admission"]
    assert doc.chunks[0].text.startswith("Programme Test — Durée : Le programme dure 18 mois")


def test_parse_target_all_means_every_program():
    raw = DOC.replace("target: prog_a", "target: all")
    assert parse_document("t", raw).target_code is None


def test_parse_long_sections_are_split_under_the_size_limit():
    paragraphs = "\n\n".join(f"Paragraphe {i}. " + "mot " * 80 for i in range(8))
    doc = parse_document("long", f"---\ntitle: Long\n---\n## Gros\n{paragraphs}\n")
    assert len(doc.chunks) > 1
    assert all(len(c.text) < 1200 for c in doc.chunks)
    assert {c.heading for c in doc.chunks} == {"Gros"}


@pytest.mark.parametrize(
    "raw",
    [
        "pas d'en-tête\n## A\ntexte",
        "---\ntitle: X\n---\n",
        "---\ntitle: X\nligne cassée\n---\n## A\nb",
    ],
)
def test_parse_rejects_malformed_documents(raw):
    with pytest.raises(DocumentFormatError):
        parse_document("x", raw)


def test_content_hash_changes_with_the_content():
    assert parse_document("a", DOC).content_hash != parse_document("a", DOC + "\nplus").content_hash


def test_every_demo_document_is_valid_and_marked_fictitious():
    files = sorted(DEMO_KB_DIR.glob("*.md"))
    assert len(files) >= 4
    for f in files:
        raw = f.read_text(encoding="utf-8")
        assert "FICTIVES" in raw.split("---")[1], f"{f.name} doit se déclarer fictif"
        assert parse_document(f.stem, raw).chunks
    slugs = {f.stem for f in files}
    cases = json.loads((DEMO_KB_DIR / "eval.json").read_text(encoding="utf-8"))
    assert {c["expect"] for c in cases if c["expect"]} <= slugs


# --- Ingestion ---


async def test_ingest_is_idempotent_and_updates_on_change(session_factory):
    emb = HashEmbeddings()
    async with session_factory() as s:
        first = await knowledge.ingest_document(s, emb, "prog-a", DOC)
        again = await knowledge.ingest_document(s, emb, "prog-a", DOC)
        changed = await knowledge.ingest_document(s, emb, "prog-a", DOC.replace("18", "24"))
        chunks = await s.scalar(select(func.count()).select_from(KnowledgeChunk))
        docs = await s.scalar(select(func.count()).select_from(KnowledgeDocument))
    assert (first.status, again.status, changed.status) == (
        IngestStatus.CREATED,
        IngestStatus.UNCHANGED,
        IngestStatus.UPDATED,
    )
    assert docs == 1 and chunks == 2  # l'ancienne version est remplacée, pas dupliquée


async def test_delete_and_list(session_factory):
    emb = HashEmbeddings()
    async with session_factory() as s:
        await knowledge.ingest_document(s, emb, "a", DOC)
        await knowledge.ingest_document(s, emb, "b", GENERAL, is_demo=True)
        listing = await knowledge.list_documents(s)
        assert [(d.slug, d.chunks, d.is_demo) for d in listing] == [("a", 2, False), ("b", 1, True)]
        assert await knowledge.delete_demo_documents(s) == 1
        assert await knowledge.delete_document(s, "a") is True
        assert await knowledge.delete_document(s, "a") is False
        assert await s.scalar(select(func.count()).select_from(KnowledgeChunk)) == 0


# --- Recherche ---


def make_kb(session_factory, *, min_score=0.3, include_demo=True, embeddings=None):
    return PgKnowledgeBase(
        session_factory,
        embeddings or HashEmbeddings(),
        min_score=min_score,
        include_demo=include_demo,
    )


@pytest.fixture
async def loaded(session_factory):
    emb = HashEmbeddings()
    async with session_factory() as s:
        await knowledge.ingest_document(s, emb, "prog-a", DOC)
        await knowledge.ingest_document(s, emb, "prog-b", OTHER)
        await knowledge.ingest_document(s, emb, "faq", GENERAL)
    return session_factory


async def test_search_returns_the_relevant_passage_with_its_source(loaded):
    kb = make_kb(loaded)
    top = (await kb.search("Combien de temps dure le programme en alternance ?", "prog_a"))[0]
    assert "18 mois" in top.text and top.source == "Programme Test / Durée"
    assert top.score is not None and top.score >= 0.3


async def test_off_topic_question_returns_nothing(loaded):
    assert (
        await make_kb(loaded).search("Quelle est la meilleure recette de pizza ?", "prog_a") == []
    )


async def test_search_is_restricted_to_the_prospect_program_plus_general_info(loaded):
    kb = make_kb(loaded)
    texts = [p.text for p in await kb.search("Le programme dure combien de mois ?", "prog_a", 10)]
    assert any("18 mois" in t for t in texts) and not any("6 mois" in t for t in texts)
    general = await kb.search("conseiller visioconférence candidats", "prog_a")
    assert general and general[0].source.startswith("FAQ générale")
    assert any("6 mois" in p.text for p in await kb.search("durée 6 mois le soir", None, 10))


async def test_demo_documents_are_never_served_when_excluded(session_factory):
    emb = HashEmbeddings()
    async with session_factory() as s:
        await knowledge.ingest_document(s, emb, "demo", GENERAL, is_demo=True)
    query = "conseiller visioconférence candidats"
    assert await make_kb(session_factory, include_demo=True).search(query, None)
    assert await make_kb(session_factory, include_demo=False).search(query, None) == []


async def test_vectors_of_another_embedding_model_are_ignored(loaded):
    class OtherModel(HashEmbeddings):
        model_id = "fake/autre-modele"

    kb = make_kb(loaded, embeddings=OtherModel())
    assert await kb.search("Le programme dure combien de mois ?", "prog_a") == []
    async with loaded() as s:  # après ré-indexation, ils redeviennent utilisables
        await knowledge.reindex(s, OtherModel())
    assert await kb.search("Le programme dure combien de mois ?", "prog_a")


async def test_embedding_failure_degrades_to_no_passage(loaded):
    class Down(HashEmbeddings):
        async def embed_query(self, text):
            raise EmbeddingError("quota dépassé")

    assert await make_kb(loaded, embeddings=Down()).search("durée du programme", "prog_a") == []


async def test_search_all_exposes_scores_below_the_threshold(loaded):
    kb = make_kb(loaded, min_score=0.99)
    assert await kb.search("Le programme dure combien de mois ?", "prog_a") == []
    assert (await kb.search_all("Le programme dure combien de mois ?", "prog_a"))[0].score


# --- Configuration ---


def test_missing_key_disables_embeddings_instead_of_crashing():
    from app.config import Settings

    assert create_embeddings(Settings(gemini_api_key=None, _env_file=None)) is None
    with pytest.raises(EmbeddingError):
        create_embeddings(Settings(embedding_provider="inconnu", _env_file=None))


# --- Branchement dans l'agent ---


async def test_agent_answers_from_the_rag_and_hands_off_when_it_knows_nothing(
    client,
    env,
    session_factory,  # noqa: F811
):
    emb = HashEmbeddings()
    async with session_factory() as s:
        await knowledge.ingest_document(s, emb, "prog-a", DOC.replace("prog_a", "ebihar_students"))
    kb = make_kb(session_factory, min_score=0.3)
    app.dependency_overrides[get_knowledge_base] = lambda: kb

    pid, mid, cid = await lead(client, "Combien de mois dure le programme en alternance ?")
    env.llm.qualification = Qualification(intent="question")
    env.llm.reply = "Le programme dure 18 mois en alternance."
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] is None and "18 mois" in out["reply"]
    sources = (await conversation(client, cid))["messages"][-1]["metadata"]["sources"]
    assert sources == ["Programme Test / Durée"]

    pid, mid, cid = await lead(
        client, "Quel est le salaire moyen d'un astronaute ?", email="autre@example.com"
    )
    out = (await run(client, cid)).json()
    assert out["handoff_reason"] == "question_hors_base"


# --- Commandes d'administration ---


@pytest.fixture
def kb_cli(session_factory, monkeypatch):
    from app import kb_commands

    monkeypatch.setattr(kb_commands, "get_sessionmaker", lambda: session_factory)
    monkeypatch.setattr(kb_commands, "require_embeddings", lambda: HashEmbeddings())
    return kb_commands


async def test_kb_ingest_command_loads_a_directory_and_reports_bad_files(
    kb_cli, session_factory, tmp_path: Path, capsys
):
    (tmp_path / "prog-a.md").write_text(DOC, encoding="utf-8")
    (tmp_path / "casse.md").write_text("sans en-tête", encoding="utf-8")
    failures = await kb_cli.ingest_paths(kb_cli.collect_files(tmp_path), is_demo=False)
    out = capsys.readouterr().out
    assert failures == 1 and "prog-a.md : créé" in out and "casse.md" in out
    async with session_factory() as s:
        assert [d.slug for d in await knowledge.list_documents(s)] == ["prog-a"]


async def test_kb_search_command_shows_scores_and_threshold(
    kb_cli, session_factory, tmp_path: Path, capsys
):
    async with session_factory() as s:
        await knowledge.ingest_document(s, HashEmbeddings(), "prog-a", DOC)
    await kb_cli.cmd_kb_search("Combien de mois dure le programme ?", "prog_a", 3)
    out = capsys.readouterr().out
    assert "Programme Test / Durée" in out and "Seuil de pertinence" in out
