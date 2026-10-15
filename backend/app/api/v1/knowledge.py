import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status

from app.api.dependencies import (
    ADMIN_ONLY,
    ANY_ROLE,
    DbSession,
    EmbeddingsDep,
    SettingsDep,
)
from app.integrations.embeddings.base import EmbeddingError, EmbeddingModel
from app.integrations.knowledge.chunking import DocumentFormatError
from app.integrations.knowledge.pg_knowledge import PgKnowledgeBase
from app.schemas.knowledge import (
    ChunkRead,
    DocumentDetailRead,
    DocumentRead,
    DocumentWrite,
    IngestRead,
    KnowledgeStatus,
    SearchHit,
    SearchRequest,
    SearchResult,
)
from app.services import knowledge as service
from app.services.knowledge import DocumentSummary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"], dependencies=[ANY_ROLE])

Slug = Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9_-]{0,99}$")]
_NOT_CONFIGURED = (
    "Embeddings non configurés : renseignez la clé (GEMINI_API_KEY) dans l'environnement."
)


def _require(embeddings: EmbeddingModel | None) -> EmbeddingModel:
    if embeddings is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NOT_CONFIGURED)
    return embeddings


def _read(doc: DocumentSummary, current: str | None) -> DocumentRead:
    return DocumentRead(
        slug=doc.slug,
        title=doc.title,
        target_code=doc.target_code,
        chunks=doc.chunks,
        embedding_model=doc.embedding_model,
        is_demo=doc.is_demo,
        updated_at=doc.updated_at,
        needs_reindex=current is not None and doc.embedding_model != current,
    )


@router.get("/status", response_model=KnowledgeStatus)
async def knowledge_status(embeddings: EmbeddingsDep, settings: SettingsDep) -> KnowledgeStatus:
    return KnowledgeStatus(
        configured=embeddings is not None,
        embedding_model=embeddings.model_id if embeddings else None,
        min_score=settings.rag_min_score,
        top_k=settings.rag_top_k,
    )


@router.get("/documents", response_model=list[DocumentRead])
async def list_documents(session: DbSession, embeddings: EmbeddingsDep) -> list[DocumentRead]:
    current = embeddings.model_id if embeddings else None
    return [_read(d, current) for d in await service.list_documents(session)]


@router.get("/documents/{slug}", response_model=DocumentDetailRead)
async def get_document(
    slug: Slug, session: DbSession, embeddings: EmbeddingsDep
) -> DocumentDetailRead:
    detail = await service.get_document(session, slug)
    if detail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document introuvable")
    base = _read(detail.summary, embeddings.model_id if embeddings else None)
    return DocumentDetailRead(
        **base.model_dump(),
        source_text=detail.source_text,
        sections=[ChunkRead(heading=h, text=t) for h, t in detail.chunks],
    )


@router.put("/documents/{slug}", response_model=IngestRead, dependencies=[ADMIN_ONLY])
async def put_document(
    slug: Slug, payload: DocumentWrite, session: DbSession, embeddings: EmbeddingsDep
) -> IngestRead:
    """Ajoute ou remplace un document (Markdown avec en-tête `title:` / `target:`)."""
    model = _require(embeddings)
    try:
        result = await service.ingest_document(session, model, slug, payload.content)
    except DocumentFormatError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except EmbeddingError:
        logger.warning("Embeddings indisponibles", exc_info=True)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embeddings indisponibles : réessayez plus tard",
        ) from None
    return IngestRead(slug=result.slug, status=result.status.value, chunks=result.chunks)


@router.delete(
    "/documents/{slug}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[ADMIN_ONLY]
)
async def delete_document(slug: Slug, session: DbSession) -> None:
    if not await service.delete_document(session, slug):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document introuvable")


@router.post("/search", response_model=SearchResult)
async def search(
    payload: SearchRequest, session: DbSession, embeddings: EmbeddingsDep, settings: SettingsDep
) -> SearchResult:
    """Teste une question : extraits trouvés, score et passage ou non du seuil de pertinence."""
    model = _require(embeddings)
    kb = PgKnowledgeBase(
        lambda: session,  # inutilisé : on fournit la session de la requête
        model,
        min_score=settings.rag_min_score,
        include_demo=settings.environment != "production",
    )
    try:
        passages = await kb.search_all_in(
            session, payload.query, payload.target_code, payload.limit
        )
    except EmbeddingError:
        logger.warning("Embeddings indisponibles", exc_info=True)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embeddings indisponibles : réessayez plus tard",
        ) from None
    return SearchResult(
        threshold=settings.rag_min_score,
        results=[
            SearchHit(
                source=p.source,
                text=p.text,
                score=round(p.score or 0.0, 4),
                retained=(p.score or 0.0) >= settings.rag_min_score,
            )
            for p in passages
        ],
    )


@router.post("/reindex", dependencies=[ADMIN_ONLY])
async def reindex(session: DbSession, embeddings: EmbeddingsDep) -> dict[str, int]:
    """Recalcule tous les vecteurs avec le modèle courant (après un changement de modèle)."""
    model = _require(embeddings)
    try:
        return {"documents": await service.reindex(session, model)}
    except EmbeddingError:
        logger.warning("Embeddings indisponibles", exc_info=True)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embeddings indisponibles : réessayez plus tard",
        ) from None
