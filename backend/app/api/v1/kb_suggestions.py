"""Réponses proposées pour la base de connaissances, validées par un administrateur (D-50)."""

import logging
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.dependencies import (
    ADMIN_ONLY,
    ANY_ROLE,
    CAN_WRITE,
    CurrentScope,
    CurrentUser,
    DbSession,
    EmbeddingsDep,
    MongoDb,
)
from app.integrations.embeddings.base import EmbeddingError
from app.integrations.knowledge.chunking import DocumentFormatError
from app.schemas.kb_suggestion import (
    KbSuggestionApprove,
    KbSuggestionCreate,
    KbSuggestionPage,
    KbSuggestionPrefill,
    KbSuggestionRead,
    KbSuggestionReject,
)
from app.services import conversations
from app.services import kb_suggestions as service
from app.services import scope as scope_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge/suggestions", tags=["knowledge"], dependencies=[ANY_ROLE])


async def _visible(session: DbSession, db: MongoDb, scope: CurrentScope, conv_id: str) -> None:
    doc = await conversations.get_doc(db, conv_id)
    await scope_service.ensure_visible(session, scope, int(doc["prospect_id"]))


@router.get("", response_model=KbSuggestionPage)
async def list_suggestions(
    session: DbSession,
    db: MongoDb,
    scope: CurrentScope,
    status_: Annotated[
        str | None, Query(alias="status", pattern="^(pending|approved|rejected)$")
    ] = None,
    conversation_id: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> KbSuggestionPage:
    """Propositions, les plus récentes d'abord (périmètre du conseiller)."""
    items, total = await service.list_suggestions(
        session,
        db,
        status=status_,
        conversation_id=conversation_id,
        limit=limit,
        prospect_ids=await scope_service.prospect_ids(session, scope),
    )
    return KbSuggestionPage(items=items, total=total)


@router.get("/prefill", response_model=KbSuggestionPrefill)
async def prefill(
    conversation_id: Annotated[str, Query(min_length=1, max_length=64)],
    session: DbSession,
    db: MongoDb,
    scope: CurrentScope,
) -> KbSuggestionPrefill:
    """Question du prospect, réponse du conseiller et programme, pour pré-remplir la proposition."""
    await _visible(session, db, scope, conversation_id)
    return await service.prefill(db, conversation_id)


@router.post(
    "",
    response_model=KbSuggestionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def propose(
    payload: KbSuggestionCreate,
    session: DbSession,
    db: MongoDb,
    scope: CurrentScope,
    user: CurrentUser,
) -> KbSuggestionRead:
    """« Ajouter à la base » : la réponse attend la validation d'un administrateur."""
    await _visible(session, db, scope, payload.conversation_id)
    return await service.propose(
        session,
        db,
        conversation_id=payload.conversation_id,
        question=payload.question,
        answer=payload.answer,
        target_code=payload.target_code,
        user=user,
    )


@router.post("/{suggestion_id}/approve", response_model=KbSuggestionRead, dependencies=[ADMIN_ONLY])
async def approve(
    suggestion_id: str,
    payload: KbSuggestionApprove,
    session: DbSession,
    db: MongoDb,
    embeddings: EmbeddingsDep,
    user: CurrentUser,
) -> KbSuggestionRead:
    """Valide la réponse (corrigée au besoin) : elle rejoint la FAQ de son programme."""
    if embeddings is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embeddings non configurés : renseignez la clé (GEMINI_API_KEY) dans "
            "l'environnement.",
        )
    try:
        return await service.approve(
            session,
            db,
            embeddings,
            suggestion_id,
            question=payload.question,
            answer=payload.answer,
            target_code=payload.target_code,
            keep_target="target_code" not in payload.model_fields_set,
            user=user,
        )
    except DocumentFormatError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except EmbeddingError:
        logger.warning("Embeddings indisponibles", exc_info=True)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embeddings indisponibles : réessayez plus tard",
        ) from None


@router.post("/{suggestion_id}/reject", response_model=KbSuggestionRead, dependencies=[ADMIN_ONLY])
async def reject(
    suggestion_id: str,
    payload: KbSuggestionReject,
    session: DbSession,
    db: MongoDb,
    user: CurrentUser,
) -> KbSuggestionRead:
    """Refuse la proposition : rien n'entre dans la base, le motif reste dans l'historique."""
    return await service.reject(session, db, suggestion_id, reason=payload.reason, user=user)
