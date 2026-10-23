"""Agenda : réglage par l'administrateur, connexion OAuth Google de chaque conseiller."""

import logging
from typing import Annotated
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.api.dependencies import (
    ADMIN_ONLY,
    ANY_ROLE,
    CurrentUser,
    DbSession,
    MongoDb,
    SettingsDep,
)
from app.config import Settings
from app.graph.ports import CalendarError
from app.integrations.calendar import google_oauth
from app.models import User
from app.schemas.calendar import (
    CalendarConnectionRead,
    CalendarSettingsRead,
    CalendarSettingsWrite,
    ConnectIn,
    ConnectOut,
    MyCalendarRead,
)
from app.services import calendar_config

logger = logging.getLogger(__name__)
admin_router = APIRouter(prefix="/integrations", tags=["calendar"], dependencies=[ADMIN_ONLY])
router = APIRouter(prefix="/calendar", tags=["calendar"], dependencies=[ANY_ROLE])
callback_router = APIRouter(prefix="/calendar", tags=["calendar"])
CALLBACK = "google_calendar_callback"


def _redirect_uri(request: Request) -> str:
    return str(request.url_for(CALLBACK))


def safe_return(settings: Settings, return_to: str) -> str:
    """Retour uniquement vers une origine autorisée de la console (pas de redirection ouverte)."""
    parsed = urlparse(return_to)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    allowed = [o.rstrip("/") for o in settings.cors_origins]
    if origin in allowed:
        return f"{origin}{parsed.path or '/'}"
    return f"{allowed[0]}/account" if allowed else "/"


# --- Administrateur ----------------------------------------------------------------------------


@admin_router.get("/calendar", response_model=CalendarSettingsRead)
async def get_settings_(
    request: Request, settings: SettingsDep, db: MongoDb, session: DbSession
) -> CalendarSettingsRead:
    cfg = await calendar_config.setup(db, settings)
    doc = await calendar_config.load(db) or {}
    connections = await calendar_config.list_connections(db)
    rows = await session.execute(
        select(User.id, User.username).where(User.id.in_([c["_id"] for c in connections]))
    )
    names: dict[int, str] = {row[0]: row[1] for row in rows.all()}
    return CalendarSettingsRead(
        provider=cfg.provider,
        source=cfg.source,
        google_client_id=cfg.client_id,
        client_secret_set=bool(doc.get("client_secret_enc")),
        default_user_id=cfg.default_user_id,
        redirect_uri=_redirect_uri(request),
        connections=[
            CalendarConnectionRead(
                user_id=c["_id"],
                username=names.get(c["_id"]),
                account_email=c.get("account_email"),
                connected_at=c.get("connected_at"),
                last_error=c.get("last_error"),
            )
            for c in connections
        ],
    )


@admin_router.put("/calendar", status_code=status.HTTP_204_NO_CONTENT)
async def put_settings(
    payload: CalendarSettingsWrite, settings: SettingsDep, db: MongoDb, user: CurrentUser
) -> Response:
    """Effet immédiat : l'agenda est relu à chaque demande de rendez-vous."""
    if payload.provider == "demo" and settings.environment == "production":
        raise HTTPException(422, detail="L'agenda de démonstration est interdit en production")
    data = payload.model_dump()
    data["google_client_secret"] = (
        payload.google_client_secret.get_secret_value() if payload.google_client_secret else None
    )
    if payload.provider == "google" and not payload.google_client_id.strip():
        raise HTTPException(422, detail="Identifiant client Google requis")
    await calendar_config.save(db, settings, data, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Conseiller : son propre agenda -------------------------------------------------------------


@router.get("/me", response_model=MyCalendarRead)
async def my_calendar(settings: SettingsDep, db: MongoDb, user: CurrentUser) -> MyCalendarRead:
    cfg = await calendar_config.setup(db, settings)
    available = cfg.provider == "google" and bool(cfg.client_id and cfg.client_secret)
    connection = await calendar_config.get_connection(db, user.id)
    return MyCalendarRead(
        available=available,
        connected=bool(connection),
        account_email=connection.get("account_email") if connection else None,
        connected_at=connection.get("connected_at") if connection else None,
        last_error=connection.get("last_error") if connection else None,
    )


@router.post("/google/connect", response_model=ConnectOut)
async def connect(
    payload: ConnectIn, request: Request, settings: SettingsDep, db: MongoDb, user: CurrentUser
) -> ConnectOut:
    """Adresse Google où envoyer le conseiller pour autoriser l'accès à son agenda."""
    cfg = await calendar_config.setup(db, settings)
    if not (cfg.provider == "google" and cfg.client_id and cfg.client_secret):
        raise HTTPException(
            409, detail="Google Agenda n'est pas encore branché par l'administrateur"
        )
    state = calendar_config.make_state(settings, user.id, safe_return(settings, payload.return_to))
    return ConnectOut(
        url=google_oauth.authorization_url(
            cfg.client_id, _redirect_uri(request), state, login_hint=user.email
        )
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(settings: SettingsDep, db: MongoDb, user: CurrentUser) -> Response:
    connection = await calendar_config.delete_connection(db, user.id)
    token = calendar_config.refresh_token(settings, connection) if connection else None
    if token:
        async with httpx.AsyncClient(timeout=google_oauth.TIMEOUT) as http:
            await google_oauth.revoke(http, token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Retour de Google (navigateur, sans jeton IAGORA : l'état signé fait foi) --------------------


@callback_router.get("/google/callback", name=CALLBACK)
async def google_callback(
    request: Request,
    settings: SettingsDep,
    db: MongoDb,
    state: Annotated[str, Query(max_length=2000)] = "",
    code: Annotated[str | None, Query(max_length=2000)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    parsed = calendar_config.read_state(settings, state)
    if parsed is None:
        raise HTTPException(400, detail="Lien de connexion expiré ou invalide : recommencez")
    user_id, return_to = parsed
    target = safe_return(settings, return_to)

    def back(result: str, detail: str | None = None) -> RedirectResponse:
        query = {"calendar": result, **({"detail": detail} if detail else {})}
        return RedirectResponse(f"{target}?{urlencode(query)}", status_code=303)

    if error or not code:
        return back("refused", error or "aucun code")
    cfg = await calendar_config.setup(db, settings)
    if not (cfg.client_id and cfg.client_secret):
        return back("error", "Google Agenda n'est plus branché")
    try:
        async with httpx.AsyncClient(timeout=google_oauth.TIMEOUT) as http:
            refresh, email = await google_oauth.exchange_code(
                http, cfg.client_id, cfg.client_secret, code, _redirect_uri(request)
            )
    except CalendarError as exc:
        logger.warning("Connexion Google Agenda échouée pour l'utilisateur %s", user_id)
        return back("error", str(exc))
    await calendar_config.save_connection(db, settings, user_id, refresh, email)
    logger.info("Agenda Google connecté pour l'utilisateur %s", user_id)
    return back("connected")
