from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.dependencies import ADMIN_ONLY, ANY_ROLE, CurrentUser, DbSession
from app.schemas.common import Page
from app.schemas.user import (
    AdvisorRead,
    TemporaryPassword,
    UserCreate,
    UserCreated,
    UserRead,
    UserUpdate,
)
from app.services import users as service

router = APIRouter(prefix="/users", tags=["users"], dependencies=[ADMIN_ONLY])
advisors_router = APIRouter(prefix="/advisors", tags=["users"], dependencies=[ANY_ROLE])


@advisors_router.get("", response_model=Page[AdvisorRead])
async def list_advisors(
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdvisorRead]:
    rows, total = await service.list_advisors(session, limit, offset)
    return Page[AdvisorRead](
        items=[AdvisorRead.model_validate(u) for u in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=UserCreated, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, session: DbSession, actor: CurrentUser) -> UserCreated:
    """Crée un membre. Il devra choisir son mot de passe à la première connexion ; sans mot de
    passe fourni, un mot de passe temporaire est généré et renvoyé UNE seule fois."""
    user, generated = await service.create_user(
        session, payload, actor=f"user:{actor.id}", must_change_password=True
    )
    return UserCreated(**UserRead.model_validate(user).model_dump(), temporary_password=generated)


@router.get("", response_model=Page[UserRead])
async def list_users(
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[UserRead]:
    rows, total = await service.list_users(session, limit, offset)
    return Page[UserRead](
        items=[UserRead.model_validate(u) for u in rows], total=total, limit=limit, offset=offset
    )


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: int, session: DbSession) -> UserRead:
    return UserRead.model_validate(await service.get_user(session, user_id))


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int, payload: UserUpdate, session: DbSession, actor: CurrentUser
) -> UserRead:
    user = await service.update_user(session, user_id, payload, actor=actor)
    return UserRead.model_validate(user)


@router.post("/{user_id}/reset-password", response_model=TemporaryPassword)
async def reset_password(user_id: int, session: DbSession, actor: CurrentUser) -> TemporaryPassword:
    """Nouveau mot de passe temporaire (affiché une fois) ; les sessions du membre sont fermées."""
    return TemporaryPassword(
        temporary_password=await service.reset_password(session, user_id, actor=actor)
    )
