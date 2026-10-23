"""Client Zoom (application Server-to-Server OAuth) : création d'une réunion planifiée."""

import time
from datetime import UTC, datetime
from typing import Any

import httpx

from app.config import Settings
from app.graph.ports import CalendarError

TOKEN_URL = "https://zoom.us/oauth/token"  # noqa: S105 - URL publique, pas un secret
API = "https://api.zoom.us/v2"
TIMEOUT = 15.0


class ZoomClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self._s = settings
        self._http = http or httpx.AsyncClient(timeout=TIMEOUT)
        self._token: str | None = None
        self._token_expiry = 0.0

    @property
    def configured(self) -> bool:
        s = self._s
        return bool(s.zoom_account_id and s.zoom_client_id and s.zoom_client_secret)

    async def _access_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        s = self._s
        assert s.zoom_client_secret is not None  # noqa: S101 - garanti par `configured`
        try:
            response = await self._http.post(
                TOKEN_URL,
                params={"grant_type": "account_credentials", "account_id": s.zoom_account_id},
                auth=(s.zoom_client_id, s.zoom_client_secret.get_secret_value()),
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
        response = await self._create(host or self._s.zoom_host_user, payload)
        if response.status_code == 404 and host and host != self._s.zoom_host_user:
            # Le conseiller n'a pas de compte Zoom : on utilise l'hôte par défaut.
            response = await self._create(self._s.zoom_host_user, payload)
        if response.status_code >= 400:
            raise CalendarError(f"Zoom : création de la réunion refusée ({response.status_code})")
        body = response.json()
        return str(body["id"]), str(body["join_url"])
