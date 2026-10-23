"""Client Zoom : création d'une réunion planifiée.

Deux authentifications : application « Server-to-Server OAuth » du compte Zoom de l'école
(identifiants saisis dans la console, à défaut le `.env`), ou jeton OAuth d'un conseiller qui a
connecté son propre compte Zoom (`token_provider`, réunion créée à son nom).
"""

import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import Settings
from app.graph.ports import CalendarError

TOKEN_URL = "https://zoom.us/oauth/token"  # noqa: S105 - URL publique, pas un secret
API = "https://api.zoom.us/v2"
TIMEOUT = 15.0


class ZoomClient:
    def __init__(
        self,
        settings: Settings,
        http: httpx.AsyncClient | None = None,
        *,
        account_id: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
        host_user: str | None = None,
        token_provider: Callable[[], Awaitable[str]] | None = None,
        enabled: bool = True,
    ) -> None:
        self._s = settings
        self._http = http or httpx.AsyncClient(timeout=TIMEOUT)
        self._token: str | None = None
        self._token_expiry = 0.0
        env_secret = (
            settings.zoom_client_secret.get_secret_value() if settings.zoom_client_secret else ""
        )
        explicit = account_id is not None
        self._account_id = (account_id or "") if explicit else settings.zoom_account_id
        self._client_id = (client_id or "") if explicit else settings.zoom_client_id
        self._client_secret = (client_secret or "") if explicit else env_secret
        self._host_user = host_user or settings.zoom_host_user
        self._token_provider = token_provider
        self._enabled = enabled

    @property
    def configured(self) -> bool:
        if not self._enabled:
            return False
        if self._token_provider is not None:
            return True
        return bool(self._account_id and self._client_id and self._client_secret)

    async def _access_token(self) -> str:
        if self._token_provider is not None:
            return await self._token_provider()
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        try:
            response = await self._http.post(
                TOKEN_URL,
                params={"grant_type": "account_credentials", "account_id": self._account_id},
                auth=(self._client_id, self._client_secret),
            )
        except httpx.HTTPError as exc:
            raise CalendarError(f"Zoom injoignable ({type(exc).__name__})") from exc
        if response.status_code != 200:
            raise CalendarError(f"Zoom : authentification refusée ({response.status_code})")
        body = response.json()
        self._token = str(body["access_token"])
        self._token_expiry = time.time() + int(body.get("expires_in", 3600))
        return self._token

    async def _create(self, host: str, payload: dict[str, Any]) -> httpx.Response:
        token = await self._access_token()
        try:
            return await self._http.post(
                f"{API}/users/{host}/meetings",
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
        except httpx.HTTPError as exc:
            raise CalendarError(f"Zoom injoignable ({type(exc).__name__})") from exc

    async def create_meeting(
        self, *, topic: str, start: datetime, minutes: int, tz: str, host: str | None
    ) -> tuple[str, str]:
        """Retourne (identifiant de réunion, lien de connexion)."""
        payload = {
            "topic": topic,
            "type": 2,
            "start_time": start.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "duration": minutes,
            "timezone": tz,
            "settings": {"join_before_host": False, "waiting_room": True},
        }
        if self._token_provider is not None:  # compte Zoom du conseiller : réunion à son nom
            response = await self._create("me", payload)
        else:
            response = await self._create(host or self._host_user, payload)
            if response.status_code == 404 and host and host != self._host_user:
                # Le conseiller n'a pas de compte Zoom dans l'école : hôte par défaut.
                response = await self._create(self._host_user, payload)
        if response.status_code >= 400:
            raise CalendarError(f"Zoom : création de la réunion refusée ({response.status_code})")
        body = response.json()
        return str(body["id"]), str(body["join_url"])
