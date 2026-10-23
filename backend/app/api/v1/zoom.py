"""Zoom : réglage par l'administrateur, connexion OAuth du compte Zoom de chaque conseiller."""

import logging
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.api.dependencies import ADMIN_ONLY, ANY_ROLE, CurrentUser, DbSession, MongoDb, SettingsDep
from app.api.v1.calendar import safe_return
from app.graph.ports import CalendarError
from app.integrations.calendar import zoom_oauth
from app.models import User
from app.schemas.calendar import ConnectIn, ConnectOut
from app.schemas.zoom import MyZoomRead, ZoomConnectionRead, ZoomSettingsRead, ZoomSettingsWrite
from app.services import calendar_config, zoom_config

logger = logging.getLogger(__name__)
admin_router = APIRouter(prefix="/integrations", tags=["zoom"], dependencies=[ADMIN_ONLY])
router = APIRouter(prefix="/zoom", tags=["zoom"], dependencies=[ANY_ROLE])
callback_router = APIRouter(prefix="/zoom", tags=["zoom"])
CALLBACK = "zoom_callback"


def _redirect_uri(request: Request) -> str:
    return str(request.url_for(CALLBACK))


@admin_router.get("/zoom", response_model=ZoomSettingsRead)
async def get_zoom_settings(
    request: Request, settings: SettingsDep, db: MongoDb, session: DbSession
) -> ZoomSettingsRead:
    z = await zoom_config.setup(db, settings)
    connections = await zoom_config.list_connections(db)
    rows = await session.execute(
        select(User.id, User.username).where(User.id.in_([c["_id"] for c in connections]))
    )
    names: dict[int, str] = {row[0]: row[1] for row in rows.all()}
    return ZoomSettingsRead(
        mode=z.mode,
        source=z.source,
        account_id=z.account_id,
        client_id=z.client_id,
        client_secret_set=bool(z.client_secret),
        host_user=z.host_user,
        redirect_uri=_redirect_uri(request),
        connections=[
            ZoomConnectionRead(
                user_id=c["_id"],
                username=names.get(c["_id"]),
                account_email=c.get("account_email"),
                connected_at=c.get("connected_at"),
                last_error=c.get("last_error"),
            )
            for c in connections
        ],
    )


@admin_router.put("/zoom", status_code=status.HTTP_204_NO_CONTENT)
async def put_zoom_settings(
    payload: ZoomSettingsWrite, settings: SettingsDep, db: MongoDb, user: CurrentUser
) -> Response:
    """Effet immédiat sur les prochains rendez-vous."""
    if payload.mode != "none" and not payload.client_id.strip():
        raise HTTPException(422, detail="Client ID Zoom requis")
    if payload.mode == "account" and not payload.account_id.strip():
        raise HTTPException(422, detail="Account ID Zoom requis (application Server-to-Server)")
    data = payload.model_dump()
    data["client_secret"] = (
        payload.client_secret.get_secret_value() if payload.client_secret else None
    )
    await zoom_config.save(db, settings, data, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=MyZoomRead)
async def my_zoom(settings: SettingsDep, db: MongoDb, user: CurrentUser) -> MyZoomRead:
    z = await zoom_config.setup(db, settings)
    connection = await zoom_config.get_connection(db, user.id)
    return MyZoomRead(
        mode=z.mode,
        connected=bool(connection),
        account_email=connection.get("account_email") if connection else None,
        connected_at=connection.get("connected_at") if connection else None,
        last_error=connection.get("last_error") if connection else None,
    )


@router.post("/connect", response_model=ConnectOut)
async def connect_zoom(
    payload: ConnectIn, request: Request, settings: SettingsDep, db: MongoDb, user: CurrentUser
) -> ConnectOut:
    z = await zoom_config.setup(db, settings)
    if not (z.mode == "advisor" and z.client_id and z.client_secret):
        raise HTTPException(409, detail="La connexion Zoom par conseiller n'est pas activée")
    state = calendar_config.make_state(
        settings, user.id, safe_return(settings, payload.return_to), zoom_config.STATE_PURPOSE
    )
    return ConnectOut(url=zoom_oauth.authorization_url(z.client_id, _redirect_uri(request), state))


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_zoom(settings: SettingsDep, db: MongoDb, user: CurrentUser) -> Response:
    connection = await zoom_config.delete_connection(db, user.id)
    token = zoom_config.refresh_token(settings, connection)
    z = await zoom_config.setup(db, settings)
    if token and z.client_secret:
        async with httpx.AsyncClient(timeout=zoom_oauth.TIMEOUT) as http:
            await zoom_oauth.revoke(http, z.client_id, z.client_secret, token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@callback_router.get("/callback", name=CALLBACK)
async def zoom_callback(
    request: Request,
    settings: SettingsDep,
    db: MongoDb,
    state: Annotated[str, Query(max_length=2000)] = "",
    code: Annotated[str | None, Query(max_length=2000)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> RedirectResponse:
    parsed = calendar_config.read_state(settings, state, zoom_config.STATE_PURPOSE)
    if parsed is None:
        raise HTTPException(400, detail="Lien de connexion expiré ou invalide : recommencez")
    user_id, return_to = parsed
    target = safe_return(settings, return_to)

    def back(result: str, detail: str | None = None) -> RedirectResponse:
        query = {"zoom": result, **({"detail": detail} if detail else {})}
        return RedirectResponse(f"{target}?{urlencode(query)}", status_code=303)

    if error or not code:
        return back("refused", error or "aucun code")
    z = await zoom_config.setup(db, settings)
    if not (z.client_id and z.client_secret):
        return back("error", "Zoom n'est plus branché")
    try:
        async with httpx.AsyncClient(timeout=zoom_oauth.TIMEOUT) as http:
            access, refresh, _ = await zoom_oauth.exchange_code(
                http, z.client_id, z.client_secret, code, _redirect_uri(request)
            )
            email = await zoom_oauth.account_email(http, access)
    except CalendarError as exc:
        logger.warning("Connexion Zoom échouée pour l'utilisateur %s", user_id)
        return back("error", str(exc))
    await zoom_config.save_connection(db, settings, user_id, refresh, email)
    logger.info("Zoom connecté pour l'utilisateur %s", user_id)
    return back("connected")
