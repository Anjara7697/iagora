"""Client Google Calendar (API officielle). Authentification par compte de service ou par le
jeton OAuth d'un conseiller (`token_provider`). Aucun secret n'est journalisé."""

import json
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import jwt

from app.config import Settings
from app.graph.ports import CalendarError

SCOPE = "https://www.googleapis.com/auth/calendar"
API = "https://www.googleapis.com/calendar/v3"
TIMEOUT = 15.0


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class GoogleCalendarClient:
    def __init__(
        self,
        settings: Settings,
        http: httpx.AsyncClient | None = None,
        token_provider: Callable[[], Awaitable[str]] | None = None,
    ) -> None:
        self._settings = settings
        self._http = http or httpx.AsyncClient(timeout=TIMEOUT)
        self._token_provider = token_provider
        self._token: str | None = None
        self._token_expiry = 0.0

    def _credentials(self) -> dict[str, Any]:
        s = self._settings
        try:
            inline = s.google_service_account_json
            if inline is not None and inline.get_secret_value().strip():
                raw = inline.get_secret_value()
            elif s.google_service_account_file:
                raw = Path(s.google_service_account_file).read_text(encoding="utf-8")
            else:
                raise CalendarError("Google Calendar : compte de service non configuré")
            data = json.loads(raw)
            return {k: data[k] for k in ("client_email", "private_key", "token_uri")}
        except (OSError, ValueError, KeyError) as exc:
            raise CalendarError("Google Calendar : clé du compte de service illisible") from exc

    async def _access_token(self) -> str:
        if self._token_provider is not None:
            return await self._token_provider()
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        cred = self._credentials()
        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": cred["client_email"],
                "scope": SCOPE,
                "aud": cred["token_uri"],
                "iat": now,
                "exp": now + 3600,
            },
            cred["private_key"],
            algorithm="RS256",
        )
        try:
            response = await self._http.post(
                cred["token_uri"],
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
        except httpx.HTTPError as exc:
            raise CalendarError(f"Google Calendar injoignable ({type(exc).__name__})") from exc
        if response.status_code != 200:
            raise CalendarError(
                f"Google Calendar : authentification refusée ({response.status_code})"
            )
        body = response.json()
        self._token = str(body["access_token"])
        self._token_expiry = time.time() + int(body.get("expires_in", 3600))
        return self._token

    async def _call(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        token = await self._access_token()
        try:
            response = await self._http.request(
                method, url, headers={"Authorization": f"Bearer {token}"}, **kwargs
            )
        except httpx.HTTPError as exc:
            raise CalendarError(f"Google Calendar injoignable ({type(exc).__name__})") from exc
        if response.status_code >= 400:
            raise CalendarError(f"Google Calendar : erreur {response.status_code}")
        return dict(response.json())

    async def busy(
        self, calendar_id: str, start: datetime, end: datetime, tz: str
    ) -> list[tuple[datetime, datetime]]:
        body = await self._call(
            "POST",
            f"{API}/freeBusy",
            json={
                "timeMin": _iso(start),
                "timeMax": _iso(end),
                "timeZone": tz,
                "items": [{"id": calendar_id}],
            },
        )
        entry = (body.get("calendars") or {}).get(calendar_id) or {}
        if entry.get("errors"):
            raise CalendarError(
                f"Agenda « {calendar_id} » inaccessible : le partager avec le compte de service"
            )
        return [(_parse(b["start"]), _parse(b["end"])) for b in entry.get("busy", [])]

    async def create_event(
        self,
        calendar_id: str,
        *,
        summary: str,
        description: str,
        start: datetime,
        end: datetime,
        location: str | None,
    ) -> str:
        event: dict[str, Any] = {
            "summary": summary,
            "description": description,
            "start": {"dateTime": _iso(start)},
            "end": {"dateTime": _iso(end)},
        }
        if location:
            event["location"] = location
        body = await self._call(
            "POST",
            f"{API}/calendars/{calendar_id}/events",
            params={"sendUpdates": "none"},
            json=event,
        )
        return str(body["id"])
