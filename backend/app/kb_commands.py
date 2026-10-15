"""Commandes de gestion de la base de connaissances (RAG) : `python -m app.cli kb-…`.

Utilisables en production (c'est ainsi que les documents officiels sont chargés), à la différence
des outils de recette de `app.devtools`.
"""

import sys
from pathlib import Path

from app.config import get_settings
from app.database.session import dispose_engine, get_sessionmaker
from app.graph.ports import Passage
from app.integrations.embeddings.base import EmbeddingModel
from app.integrations.embeddings.factory import create_embeddings
from app.integrations.knowledge.chunking import DocumentFormatError
from app.integrations.knowledge.pg_knowledge import PgKnowledgeBase
from app.services import knowledge


def require_embeddings() -> EmbeddingModel:
    settings = get_settings()
    embeddings = create_embeddings(settings)
    if embeddings is None:
        sys.exit(
            f"Embeddings indisponibles ({settings.embedding_provider}) : "
            "renseignez la clé (GEMINI_API_KEY) dans votre .env."
        )
    return embeddings


def build_knowledge_base(embeddings: EmbeddingModel, *, include_demo: bool) -> PgKnowledgeBase:
    settings = get_settings()
    return PgKnowledgeBase(
        get_sessionmaker(),
        embeddings,
        min_score=settings.rag_min_score,
        include_demo=include_demo,
    )


def collect_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    files = sorted(path.glob("*.md"))
    if not files:
        sys.exit(f"Aucun fichier .md dans {path}")
    return files


async def ingest_paths(paths: list[Path], *, is_demo: bool) -> int:
    embeddings = require_embeddings()
    failures = 0
    async with get_sessionmaker()() as session:
        for file in paths:
            try:
                result = await knowledge.ingest_document(
                    session,
                    embeddings,
                    file.stem,
                    file.read_text(encoding="utf-8"),
                    is_demo=is_demo,
                )
            except DocumentFormatError as exc:
                failures += 1
                print(f"  ✗ {file.name} : {exc}")
                continue
            print(f"  ✓ {file.name} : {result.status.value} ({result.chunks} extrait(s))")
    return failures


async def cmd_kb_ingest(path: str) -> None:
    try:
        failures = await ingest_paths(collect_files(Path(path)), is_demo=False)
    finally:
        await dispose_engine()
    sys.exit(1 if failures else 0)


async def cmd_kb_list() -> None:
    async with get_sessionmaker()() as session:
        docs = await knowledge.list_documents(session)
    await dispose_engine()
    current = get_settings().embedding_model
    if not docs:
        print("Base de connaissances vide.")
    for d in docs:
        flags = ("FICTIF " if d.is_demo else "") + (
            "" if current in d.embedding_model else "RÉINDEXER "
        )
        print(f"{d.slug:<24} {d.chunks:>3} extraits  cible={d.target_code or 'toutes'}  "
              f"{d.embedding_model}  {flags}".rstrip())  # fmt: skip


async def cmd_kb_search(query: str, target: str | None, limit: int) -> None:
    kb = build_knowledge_base(require_embeddings(), include_demo=True)
    try:
        passages = await kb.search_all(query, target, limit)
    finally:
        await dispose_engine()
    show_passages(passages, kb.min_score)


def show_passages(passages: list[Passage], threshold: float) -> None:
    if not passages:
        print("Aucun extrait (base vide, ou vecteurs d'un autre modèle : lancez kb-reindex).")
    for p in passages:
        score = p.score or 0.0
        verdict = "retenu " if score >= threshold else "écarté "
        print(f"[{score:.3f}] {verdict}{p.source}\n        {p.text[:160]}…")
    print(f"\nSeuil de pertinence : {threshold} (RAG_MIN_SCORE)")


async def cmd_kb_reindex() -> None:
    embeddings = require_embeddings()
    try:
        async with get_sessionmaker()() as session:
            count = await knowledge.reindex(session, embeddings)
    finally:
        await dispose_engine()
    print(f"{count} document(s) ré-indexé(s) avec {embeddings.model_id}.")


async def cmd_kb_delete(slug: str | None, demo: bool) -> None:
    try:
        async with get_sessionmaker()() as session:
            if demo:
                removed = await knowledge.delete_demo_documents(session)
                print(f"{removed} document(s) de démo supprimé(s).")
            elif slug and await knowledge.delete_document(session, slug):
                print(f"Document « {slug} » supprimé.")
            else:
                sys.exit("Document introuvable (voir kb-list).")
    finally:
        await dispose_engine()
