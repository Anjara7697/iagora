"""Agenda utilisé par l'agent, résolu à chaque demande à partir de la console (sans redémarrage).

- mode `demo` : créneaux fictifs (refusé en production) ;
- mode `google` + application OAuth saisie dans la console : agenda Google du conseiller attribué
  (connecté depuis « Mon compte »), à défaut celui du conseiller désigné par défaut ;
- mode `google` réglé par le `.env` (compte de service) : comportement historique ;
- sinon « agenda non branché » : la demande de rendez-vous est transférée (escalade normale).
"""

import hashlib
import time
from collections.abc import Callable
from typing import Any

import httpx

from app.agents.defaults import NOT_CONFIGURED
from app.config import Settings
from app.graph.ports import BookedMeeting, Calendar, CalendarNotConfiguredError, Slot
from app.integrations.calendar import google_oauth
from app.integrations.calendar.agenda import DemoCalendar, GoogleZoomCalendar
from app.integrations.calendar.google_calendar import GoogleCalendarClient
from app.integrations.calendar.zoom import ZoomClient
from app.services import calendar_config

TIMEOUT = 15.0


def _default_db() -> Any:
    from app.database.clients import get_mongo_db

    return get_mongo_db()


class ConsoleCalendar:
    def __init__(
        self,
        settings: Settings,
        db_provider: Callable[[], Any] = _default_db,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self._s = settings
        self._db = db_provider
        self._http = http or httpx.AsyncClient(timeout=TIMEOUT)
        self._zoom = ZoomClient(settings, self._http)
        # Jetons d'accès en cache, par conseiller ET par autorisation (une reconnexion, même avec
        # un autre compte Google, n'utilise jamais l'ancien jeton).
        self._tokens: dict[tuple[int, str], tuple[str, float]] = {}

    async def _resolve(self, advisor_id: int | None) -> Calendar:
        db = self._db()
        cfg = await calendar_config.setup(db, self._s)
        if cfg.provider == "demo":
            if self._s.environment == "production":
                raise CalendarNotConfiguredError("Agenda de démonstration interdit en production")
            return DemoCalendar(self._s)
        if cfg.provider != "google":
            raise CalendarNotConfiguredError(NOT_CONFIGURED)
        if cfg.source == "env":  # compte de service du .env
            return GoogleZoomCalendar(
                self._s, GoogleCalendarClient(self._s, self._http), self._zoom
            )
        if not (cfg.client_id and cfg.client_secret):
            raise CalendarNotConfiguredError(
                "Application Google non renseignée (Intégrations > Agenda)"
            )
        for user_id in (advisor_id, cfg.default_user_id):
            if user_id is None:
                continue
            connection = await calendar_config.get_connection(db, user_id)
            token = calendar_config.refresh_token(self._s, connection) if connection else None
            if token:
                return self._google_for(db, user_id, token, cfg.client_id, cfg.client_secret)
        raise CalendarNotConfiguredError(
            "Le conseiller n'a pas connecté son agenda Google (Mon compte)"
        )

    def _google_for(
        self, db: Any, user_id: int, refresh: str, client_id: str, secret: str
    ) -> GoogleZoomCalendar:
        key = (user_id, hashlib.sha256(refresh.encode()).hexdigest())

        async def access_token() -> str:
            cached = self._tokens.get(key)
            if cached and time.time() < cached[1] - 60:
                return cached[0]
            try:
                token, expires = await google_oauth.refresh_access_token(
                    self._http, client_id, secret, refresh
                )
            except google_oauth.CalendarAuthError as exc:
                await calendar_config.mark_error(db, user_id, str(exc))
                raise CalendarNotConfiguredError(
                    "Autorisation Google révoquée : le conseiller doit reconnecter son agenda"
                ) from exc
            self._tokens[key] = (token, time.time() + expires)
            return token

        client = GoogleCalendarClient(self._s, self._http, token_provider=access_token)
        return GoogleZoomCalendar(self._s, client, self._zoom, calendar_id="primary")

    async def get_available_slots(
        self, count: int, *, advisor_email: str | None = None, advisor_id: int | None = None
    ) -> list[Slot]:
        calendar = await self._resolve(advisor_id)
        return await calendar.get_available_slots(
            count, advisor_email=advisor_email, advisor_id=advisor_id
        )

    async def book(
        self,
        slot: Slot,
        prospect_name: str | None,
        *,
        advisor_email: str | None = None,
        advisor_id: int | None = None,
        prospect_email: str | None = None,
    ) -> BookedMeeting:
        calendar = await self._resolve(advisor_id)
        return await calendar.book(
            slot,
            prospect_name,
            advisor_email=advisor_email,
            advisor_id=advisor_id,
            prospect_email=prospect_email,
        )
