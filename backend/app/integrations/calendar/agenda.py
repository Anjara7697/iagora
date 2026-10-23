"""Agenda des conseillers : disponibilités Google Calendar, réservation, réunion Zoom.

Implémente le port `Calendar` du workflow. L'agenda interrogé est celui du conseiller attribué au
prospect (son email), à défaut l'agenda commun `GOOGLE_CALENDAR_DEFAULT_ID`.
"""

import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.config import Settings
from app.graph.ports import BookedMeeting, CalendarError, Slot
from app.integrations.calendar.availability import compute_slots
from app.integrations.calendar.google_calendar import GoogleCalendarClient
from app.integrations.calendar.zoom import ZoomClient

logger = logging.getLogger(__name__)


def _availability_args(s: Settings) -> dict[str, object]:
    return {
        "tz": s.calendar_timezone,
        "work_days": s.calendar_work_weekdays,
        "start_hour": s.calendar_work_start_hour,
        "end_hour": s.calendar_work_end_hour,
        "slot_minutes": s.calendar_slot_minutes,
        "min_notice_hours": s.calendar_min_notice_hours,
        "horizon_days": s.calendar_horizon_days,
        "buffer_minutes": s.calendar_buffer_minutes,
    }


class GoogleZoomCalendar:
    """`calendar_id` fixé (« primary ») : agenda du compte Google connecté par OAuth. Sinon
    (compte de service), l'agenda du conseiller est désigné par son email."""

    def __init__(
        self,
        settings: Settings,
        google: GoogleCalendarClient,
        zoom: ZoomClient,
        calendar_id: str | None = None,
    ) -> None:
        self._s = settings
        self._google = google
        self._zoom = zoom
        self._fixed_calendar = calendar_id

    def _calendar_id(self, advisor_email: str | None) -> str:
        if self._fixed_calendar:
            return self._fixed_calendar
        calendar_id = (advisor_email or self._s.google_calendar_default_id).strip()
        if not calendar_id:
            raise CalendarError(
                "Aucun agenda pour ce prospect (conseiller ou GOOGLE_CALENDAR_DEFAULT_ID)"
            )
        return calendar_id

    async def get_available_slots(
        self, count: int, *, advisor_email: str | None = None, advisor_id: int | None = None
    ) -> list[Slot]:
        calendar_id = self._calendar_id(advisor_email)
        now = datetime.now(UTC)
        window_end = now + timedelta(days=self._s.calendar_horizon_days + 1)
        busy = await self._google.busy(calendar_id, now, window_end, self._s.calendar_timezone)
        return compute_slots(busy, now=now, count=count, **_availability_args(self._s))  # type: ignore[arg-type]

    async def book(
        self,
        slot: Slot,
        prospect_name: str | None,
        *,
        advisor_email: str | None = None,
        advisor_id: int | None = None,
        prospect_email: str | None = None,
    ) -> BookedMeeting:
        calendar_id = self._calendar_id(advisor_email)
        tz = self._s.calendar_timezone
        # Le créneau a pu être pris depuis la proposition : on revérifie juste avant de réserver.
        if await self._google.busy(calendar_id, slot.start, slot.end, tz):
            raise CalendarError("Créneau pris entre-temps")
        who = prospect_name or "prospect"
        topic = f"Échange DATUM Academy — {who}"
        zoom_id: str | None = None
        url: str | None = None
        if self._zoom.configured:
            minutes = int((slot.end - slot.start).total_seconds() // 60)
            zoom_id, url = await self._zoom.create_meeting(
                topic=topic, start=slot.start, minutes=minutes, tz=tz, host=advisor_email
            )
        lines = [f"Rendez-vous avec {who}", f"Email : {prospect_email}" if prospect_email else ""]
        if url:
            lines.append(f"Visioconférence Zoom : {url}")
        event_id = await self._google.create_event(
            calendar_id,
            summary=topic,
            description="\n".join(line for line in lines if line),
            start=slot.start,
            end=slot.end,
            location=url,
        )
        logger.info("Rendez-vous réservé (agenda %s, créneau %s)", calendar_id, slot.id)
        return BookedMeeting(
            calendar_event_id=event_id, meeting_url=url, zoom_meeting_id=zoom_id, slot=slot
        )

    async def check(self, advisor_email: str | None = None) -> dict[str, str]:
        """Diagnostic : rien n'est réservé."""
        result: dict[str, str] = {}
        try:
            slots = await self.get_available_slots(3, advisor_email=advisor_email)
            result["google"] = f"ok ({len(slots)} créneau(x) trouvé(s))"
        except CalendarError as exc:
            result["google"] = str(exc)
        if not self._zoom.configured:
            result["zoom"] = "non configuré (rendez-vous sans lien de visioconférence)"
        else:
            try:
                await self._zoom._access_token()  # noqa: SLF001 - diagnostic interne
                result["zoom"] = "ok"
            except CalendarError as exc:
                result["zoom"] = str(exc)
        return result


class DemoCalendar:
    """Créneaux FICTIFS pour la recette locale : aucun agenda réel, aucun lien réel."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def get_available_slots(
        self, count: int, *, advisor_email: str | None = None, advisor_id: int | None = None
    ) -> list[Slot]:
        return compute_slots([], now=datetime.now(UTC), count=count, **_availability_args(self._s))  # type: ignore[arg-type]

    async def book(
        self,
        slot: Slot,
        prospect_name: str | None,
        *,
        advisor_email: str | None = None,
        advisor_id: int | None = None,
        prospect_email: str | None = None,
    ) -> BookedMeeting:
        token = uuid4().hex[:10]
        return BookedMeeting(
            calendar_event_id=f"demo-evt-{token}",
            meeting_url=f"https://zoom.example.com/demo/{token}",
            zoom_meeting_id=f"demo-zoom-{token}",
            slot=slot,
        )
