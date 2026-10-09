from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.dependencies import ADMIN_ONLY, CurrentUser, DbSession
from app.schemas.common import Page
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services import users as service

router = APIRouter(prefix="/users", tags=["users"], dependencies=[ADMIN_ONLY])


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, session: DbSession, actor: CurrentUser) -> UserRead:
    user = await service.create_user(session, payload, actor=f"user:{actor.id}")
    return UserRead.model_validate(user)


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
