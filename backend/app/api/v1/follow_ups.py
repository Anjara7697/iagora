"""Relances programmées par l'agent : les voir, les annuler, les décaler (F-16)."""

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.dependencies import (
    ANY_ROLE,
    CAN_WRITE,
    VISIBLE_PROSPECT,
    CurrentScope,
    CurrentUser,
    DbSession,
    SettingsDep,
)
from app.schemas.common import Page
from app.schemas.follow_up import FollowUpReschedule, PlannedFollowUp
from app.services import follow_ups as service

router = APIRouter(tags=["follow-ups"], dependencies=[ANY_ROLE])


@router.get("/follow-ups", response_model=Page[PlannedFollowUp])
async def list_follow_ups(
    session: DbSession,
    settings: SettingsDep,
    scope: CurrentScope,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PlannedFollowUp]:
    """Relances à venir, la plus proche d'abord (périmètre du conseiller)."""
    items, total = await service.list_planned(
        session, settings, scope=scope, limit=limit, offset=offset
    )
    return Page[PlannedFollowUp](items=items, total=total, limit=limit, offset=offset)


@router.get(
    "/prospects/{prospect_id}/follow-ups",
    response_model=list[PlannedFollowUp],
    dependencies=[VISIBLE_PROSPECT],
)
async def prospect_follow_ups(
    prospect_id: int, session: DbSession, settings: SettingsDep
) -> list[PlannedFollowUp]:
    """Relances à venir d'un prospect (la première est « la prochaine relance »)."""
    items, _ = await service.list_planned(session, settings, prospect_id=prospect_id, limit=20)
    return items


@router.post(
    "/follow-ups/{follow_up_id}/cancel",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CAN_WRITE],
)
async def cancel_follow_up(
    follow_up_id: int, session: DbSession, scope: CurrentScope, user: CurrentUser
) -> Response:
    """Annule cette relance ; 409 si elle est déjà partie ou annulée."""
    await service.cancel_by_user(session, scope, follow_up_id, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/follow-ups/{follow_up_id}/reschedule",
    response_model=PlannedFollowUp,
    dependencies=[CAN_WRITE],
)
async def reschedule_follow_up(
    follow_up_id: int,
    payload: FollowUpReschedule,
    session: DbSession,
    settings: SettingsDep,
    scope: CurrentScope,
    user: CurrentUser,
) -> PlannedFollowUp:
    """Décale cette relance ; elle reste soumise à la fenêtre d'envoi et aux garde-fous."""
    return await service.reschedule(
        session, settings, scope, follow_up_id, payload.scheduled_at, user
    )
