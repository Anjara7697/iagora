from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from app.api.dependencies import CurrentUser, DbSession, SettingsDep
from app.core.ratelimit import limiter
from app.core.security import create_access_token
from app.schemas.user import Token, UserRead
from app.services import users as service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: DbSession,
    settings: SettingsDep,
) -> Token:
    """`username` : email ou nom d'utilisateur. 5 échecs en 15 minutes bloquent les essais
    suivants pour ce couple (adresse, identifiant) : 429."""
    key = limiter.key(request.client.host if request.client else "?", form.username)
    wait = limiter.retry_after(key)
    if wait:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives : réessayez plus tard",
            headers={"Retry-After": str(wait)},
        )
    user = await service.authenticate(session, form.username, form.password)
    if user is None:
        limiter.record_failure(key)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides",
            headers={"WWW-Authenticate": "Bearer"},
        )
    limiter.reset(key)
    return Token(access_token=create_access_token(user.id, settings))


@router.get("/me", response_model=UserRead)
async def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)
