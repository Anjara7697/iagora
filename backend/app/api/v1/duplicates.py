from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencies import ANY_ROLE, CAN_WRITE, CurrentScope, CurrentUser, DbSession, MongoDb
from app.schemas.common import Page
from app.schemas.duplicate import DuplicatePair, DuplicateRead, MergeRequest
from app.schemas.prospect import ProspectRead
from app.services import duplicates as service

router = APIRouter(prefix="/duplicates", tags=["duplicates"], dependencies=[ANY_ROLE])


@router.get("", response_model=Page[DuplicatePair])
async def list_duplicates(
    session: DbSession,
    scope: CurrentScope,
    prospect_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[DuplicatePair]:
    """Doublons à trancher (les deux fiches doivent être dans le périmètre de l'utilisateur)."""
    items, total = await service.list_pending(
        session, scope, prospect_id=prospect_id, limit=limit, offset=offset
    )
    return Page(
        items=[
            DuplicatePair(
                **DuplicateRead.model_validate(item.candidate).model_dump(),
                prospects=[
                    ProspectRead.model_validate(item.first),
                    ProspectRead.model_validate(item.second),
                ],
            )
            for item in items
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/{duplicate_id}/merge", response_model=DuplicateRead, dependencies=[CAN_WRITE])
async def merge_duplicate(
    duplicate_id: int,
    payload: MergeRequest,
    session: DbSession,
    db: MongoDb,
    scope: CurrentScope,
    user: CurrentUser,
) -> DuplicateRead:
    """Fusionne les deux fiches dans `keep_prospect_id` ; l'autre fiche est supprimée et tout son
    historique (campagnes, conversations, consentements, relances, rendez-vous) est rattaché à la
    fiche gardée. Une désinscription de l'une des deux s'applique à la fiche fusionnée."""
    candidate = await service.merge(
        session, db, scope, duplicate_id, keep_id=payload.keep_prospect_id, actor_id=user.id
    )
    return DuplicateRead.model_validate(candidate)


@router.post("/{duplicate_id}/distinct", response_model=DuplicateRead, dependencies=[CAN_WRITE])
async def mark_distinct(
    duplicate_id: int, session: DbSession, scope: CurrentScope, user: CurrentUser
) -> DuplicateRead:
    """Deux personnes différentes : la paire sort de la file et n'y revient pas."""
    candidate = await service.mark_distinct(session, scope, duplicate_id, user.id)
    return DuplicateRead.model_validate(candidate)
