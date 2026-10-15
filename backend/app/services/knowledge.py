"""Gestion de la base de connaissances : ingestion, ré-indexation, suppression (RAG, F-14)."""

from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.embeddings.base import EmbeddingModel
from app.integrations.knowledge.chunking import ParsedDocument, parse_document
from app.models import KnowledgeChunk, KnowledgeDocument


class IngestStatus(StrEnum):
    CREATED = "créé"
    UPDATED = "mis à jour"
    UNCHANGED = "inchangé"


@dataclass(frozen=True)
class IngestResult:
    slug: str
    status: IngestStatus
    chunks: int


@dataclass(frozen=True)
class DocumentSummary:
    slug: str
    title: str
    target_code: str | None
    chunks: int
    embedding_model: str
    is_demo: bool


async def _replace_chunks(
    session: AsyncSession,
    doc: KnowledgeDocument,
    parsed: ParsedDocument,
    embeddings: EmbeddingModel,
) -> None:
    vectors = await embeddings.embed_documents([c.text for c in parsed.chunks])
    await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id))
    session.add_all(
        KnowledgeChunk(
            document_id=doc.id, position=i, heading=c.heading, text=c.text, embedding=vector
        )
        for i, (c, vector) in enumerate(zip(parsed.chunks, vectors, strict=True))
    )


async def ingest_document(
    session: AsyncSession,
    embeddings: EmbeddingModel,
    slug: str,
    raw: str,
    *,
    is_demo: bool = False,
) -> IngestResult:
    """Ajoute ou met à jour un document (identifié par `slug`). Idempotent : un document dont le
    contenu et le modèle d'embedding n'ont pas changé n'est pas recalculé."""
    parsed = parse_document(slug, raw)
    doc = await session.scalar(select(KnowledgeDocument).where(KnowledgeDocument.slug == slug))
    if (
        doc is not None
        and doc.content_hash == parsed.content_hash
        and doc.embedding_model == embeddings.model_id
        and doc.is_demo == is_demo
    ):
        return IngestResult(slug, IngestStatus.UNCHANGED, len(parsed.chunks))
    status = IngestStatus.UPDATED if doc is not None else IngestStatus.CREATED
    if doc is None:
        doc = KnowledgeDocument(slug=slug)
        session.add(doc)
    doc.title = parsed.title
    doc.target_code = parsed.target_code
    doc.content_hash = parsed.content_hash
    doc.embedding_model = embeddings.model_id
    doc.is_demo = is_demo
    await session.flush()
    await _replace_chunks(session, doc, parsed, embeddings)
    await session.commit()
    return IngestResult(slug, status, len(parsed.chunks))


async def reindex(session: AsyncSession, embeddings: EmbeddingModel) -> int:
    """Recalcule tous les vecteurs avec le modèle courant (après un changement de modèle).
    Retourne le nombre de documents recalculés."""
    docs = list(await session.scalars(select(KnowledgeDocument)))
    for doc in docs:
        chunks = list(
            await session.scalars(
                select(KnowledgeChunk)
                .where(KnowledgeChunk.document_id == doc.id)
                .order_by(KnowledgeChunk.position)
            )
        )
        vectors = await embeddings.embed_documents([c.text for c in chunks])
        for chunk, vector in zip(chunks, vectors, strict=True):
            chunk.embedding = vector
        doc.embedding_model = embeddings.model_id
    await session.commit()
    return len(docs)


async def delete_document(session: AsyncSession, slug: str) -> bool:
    doc = await session.scalar(select(KnowledgeDocument).where(KnowledgeDocument.slug == slug))
    if doc is None:
        return False
    await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id == doc.id))
    await session.delete(doc)
    await session.commit()
    return True


async def delete_demo_documents(session: AsyncSession) -> int:
    ids = list(
        await session.scalars(
            select(KnowledgeDocument.id).where(KnowledgeDocument.is_demo.is_(True))
        )
    )
    if ids:
        await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.document_id.in_(ids)))
        await session.execute(delete(KnowledgeDocument).where(KnowledgeDocument.id.in_(ids)))
        await session.commit()
    return len(ids)


async def list_documents(session: AsyncSession) -> list[DocumentSummary]:
    rows = await session.execute(
        select(KnowledgeDocument, func.count(KnowledgeChunk.id))
        .outerjoin(KnowledgeChunk, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .group_by(KnowledgeDocument.id)
        .order_by(KnowledgeDocument.slug)
    )
    return [
        DocumentSummary(d.slug, d.title, d.target_code, n, d.embedding_model, d.is_demo)
        for d, n in rows
    ]
