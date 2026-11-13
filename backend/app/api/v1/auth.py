from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm

from app.api import cookies
from app.api.dependencies import (
    CurrentUser,
    DbSession,
    SettingsDep,
    oauth2_scheme,
    request_token,
)
from app.core.ratelimit import limiter
from app.core.security import decode_access_claims
from app.schemas.user import PasswordChange, Token, UserRead
from app.services import auth_sessions
from app.services import users as service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
async def login(
    request: Request,
    response: Response,
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: DbSession,
    settings: SettingsDep,
) -> Token:
    """`username` : email ou nom d'utilisateur. Ouvre une session : la console la reçoit dans un
    témoin `HttpOnly` ; le jeton est aussi renvoyé pour les scripts (en-tête `Authorization`).

    Trop d'échecs en 15 minutes bloquent les essais suivants (429) : 5 pour un couple (adresse,
    identifiant), 20 pour un identifiant, 50 pour une adresse."""
    ip = request.client.host if request.client else "?"
    wait = limiter.retry_after(ip, form.username)
    if wait:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives : réessayez plus tard",
            headers={"Retry-After": str(wait)},
        )
    user = await service.authenticate(session, form.username, form.password)
    if user is None:
        limiter.record_failure(ip, form.username)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides",
            headers={"WWW-Authenticate": "Bearer"},
        )
    limiter.reset(ip, form.username)
    token = await auth_sessions.open_session(session, user, settings)
    cookies.set_session(response, settings, token)
    return Token(access_token=token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    bearer: Annotated[str | None, Depends(oauth2_scheme)],
    session: DbSession,
    settings: SettingsDep,
) -> Response:
    """Ferme la session côté serveur (AUDIT-SEC-009) et efface le témoin. Sans session valide,
    efface seulement le témoin : la déconnexion réussit toujours."""
    token, _ = request_token(request, bearer)
    claims = decode_access_claims(token, settings) if token else None
    if claims is not None:
        await auth_sessions.revoke(session, claims.session_id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    cookies.clear_session(response, settings)
    return response


@router.get("/me", response_model=UserRead)
async def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


@router.post("/password", response_model=Token)
async def change_password(
    payload: PasswordChange,
    response: Response,
    user: CurrentUser,
    session: DbSession,
    settings: SettingsDep,
) -> Token:
    """Change son propre mot de passe. Les autres sessions sont fermées ; une nouvelle session est
    ouverte pour celle-ci (témoin renouvelé)."""
    await service.change_own_password(session, user, payload.current_password, payload.new_password)
    token = await auth_sessions.open_session(session, user, settings)
    cookies.set_session(response, settings, token)
    return Token(access_token=token)
