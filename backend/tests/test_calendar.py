"""Agenda des conseillers : créneaux, Google Calendar, Zoom, agenda de démonstration."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from app.agents.defaults import UnconfiguredCalendar
from app.config import Settings
from app.graph.ports import CalendarError, Slot
from app.integrations.calendar.agenda import DemoCalendar, GoogleZoomCalendar
from app.integrations.calendar.availability import compute_slots
from app.integrations.calendar.factory import create_calendar
from app.integrations.calendar.google_calendar import GoogleCalendarClient
from app.integrations.calendar.zoom import ZoomClient
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# Un lundi à 7h UTC (9h à Paris, heure d'été).
NOW = datetime(2026, 6, 1, 7, 0, tzinfo=UTC)
RULES = {
    "tz": "Europe/Paris",
    "work_days": {1, 2, 3, 4, 5},
    "start_hour": 9,
    "end_hour": 18,
    "slot_minutes": 30,
    "min_notice_hours": 4,
    "horizon_days": 14,
}


def _key_json() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return json.dumps(
        {
            "client_email": "agent@projet.iam.gserviceaccount.com",
            "private_key": pem,
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    )


def settings(**over) -> Settings:
    base = {
        "calendar_provider": "google",
        "google_service_account_json": _key_json(),
        "zoom_account_id": "acc",
        "zoom_client_id": "cid",
        "zoom_client_secret": "secret",
        **over,
    }
    return Settings(_env_file=None, **base)


# --- Créneaux -----------------------------------------------------------------------------------


def test_slots_respect_hours_notice_and_distinct_days():
    slots = compute_slots([], now=NOW, count=3, **RULES)
    assert len(slots) == 3
    assert len({s.start.date() for s in slots}) == 3  # un jour différent chacun
    # Préavis de 4 h : le lundi, rien avant 13h Paris (11h UTC) ; jamais hors 9h-18h Paris.
    assert slots[0].start >= NOW + timedelta(hours=4)
    for s in slots:
        local = s.start.astimezone(ZoneInfo("Europe/Paris"))
        assert 9 <= local.hour < 18 and local.isoweekday() <= 5
        assert s.end - s.start == timedelta(minutes=30)


def test_busy_ranges_are_excluded():
    first = compute_slots([], now=NOW, count=1, **RULES)[0]
    busy = [(first.start - timedelta(minutes=10), first.end + timedelta(minutes=10))]
    again = compute_slots(busy, now=NOW, count=40, **RULES)
    assert all(not (s.start < busy[0][1] and s.end > busy[0][0]) for s in again)


def test_weekend_and_full_days_give_no_slot():
    assert compute_slots([], now=NOW, count=3, **{**RULES, "work_days": set()}) == []
    full = [(NOW, NOW + timedelta(days=30))]
    assert compute_slots(full, now=NOW, count=3, **RULES) == []


# --- Google Calendar et Zoom (serveurs simulés) -------------------------------------------------


class Server:
    def __init__(self, *, busy=None, calendar_error=False, zoom_status=201, zoom_404_host=None):
        self.calls: list[tuple[str, str, dict]] = []
        self.busy = busy or []
        self.calendar_error = calendar_error
        self.zoom_status = zoom_status
        self.zoom_404_host = zoom_404_host

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        body = json.loads(request.content) if request.content.startswith(b"{") else {}
        self.calls.append((request.method, url.split("?")[0], body))
        if "oauth2.googleapis.com" in url or "zoom.us/oauth" in url:
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        if url.endswith("/freeBusy"):
            cal = body["items"][0]["id"]
            entry = (
                {"errors": [{"reason": "notFound"}]} if self.calendar_error else {"busy": self.busy}
            )
            return httpx.Response(200, json={"calendars": {cal: entry}})
        if "/calendars/" in url and url.split("?")[0].endswith("/events"):
            return httpx.Response(200, json={"id": "evt-123"})
        if "api.zoom.us" in url:
            host = url.split("/users/")[1].split("/")[0]
            if self.zoom_404_host and host == self.zoom_404_host:
                return httpx.Response(404, json={})
            if self.zoom_status != 201:
                return httpx.Response(self.zoom_status, json={})
            return httpx.Response(
                201, json={"id": 987, "join_url": f"https://zoom.us/j/987?h={host}"}
            )
        return httpx.Response(500)


def agenda(server: Server, **over) -> GoogleZoomCalendar:
    s = settings(**over)
    http = httpx.AsyncClient(transport=httpx.MockTransport(server.handler))
    return GoogleZoomCalendar(s, GoogleCalendarClient(s, http), ZoomClient(s, http))


SLOT = Slot("s1", datetime(2099, 1, 5, 10, 0, tzinfo=UTC), datetime(2099, 1, 5, 10, 30, tzinfo=UTC))


def test_slots_come_from_the_advisors_own_calendar():
    server = Server()
    slots = asyncio.run(agenda(server).get_available_slots(3, advisor_email="conseil@datum.test"))
    assert len(slots) == 3
    freebusy = next(c for c in server.calls if c[1].endswith("/freeBusy"))
    assert freebusy[2]["items"] == [{"id": "conseil@datum.test"}]


def test_shared_calendar_is_used_without_advisor_and_error_without_any():
    server = Server()
    asyncio.run(
        agenda(server, google_calendar_default_id="commun@datum.test").get_available_slots(1)
    )
    assert any(c[2].get("items") == [{"id": "commun@datum.test"}] for c in server.calls)
    with pytest.raises(CalendarError, match="Aucun agenda"):
        asyncio.run(agenda(Server()).get_available_slots(1))


def test_inaccessible_calendar_asks_to_share_it():
    with pytest.raises(CalendarError, match="partager"):
        asyncio.run(
            agenda(Server(calendar_error=True)).get_available_slots(1, advisor_email="x@y.z")
        )


def test_booking_creates_zoom_meeting_and_event_with_link():
    server = Server()
    meeting = asyncio.run(
        agenda(server).book(
            SLOT, "Jean", advisor_email="conseil@datum.test", prospect_email="j@a.fr"
        )
    )
    assert meeting.calendar_event_id == "evt-123"
    assert meeting.zoom_meeting_id == "987"
    assert meeting.meeting_url and "conseil@datum.test" in meeting.meeting_url
    event = next(c for c in server.calls if c[1].endswith("/events"))
    assert "j@a.fr" in event[2]["description"] and meeting.meeting_url in event[2]["description"]
    assert event[2]["location"] == meeting.meeting_url


def test_booking_refuses_a_slot_taken_meanwhile():
    server = Server(busy=[{"start": "2099-01-05T10:00:00Z", "end": "2099-01-05T11:00:00Z"}])
    with pytest.raises(CalendarError, match="pris"):
        asyncio.run(agenda(server).book(SLOT, "Jean", advisor_email="conseil@datum.test"))
    assert not any("zoom" in c[1] and "meetings" in c[1] for c in server.calls)


def test_advisor_without_zoom_account_falls_back_to_default_host():
    server = Server(zoom_404_host="conseil@datum.test")
    meeting = asyncio.run(
        agenda(server, zoom_host_user="hote@datum.test").book(
            SLOT, "Jean", advisor_email="conseil@datum.test"
        )
    )
    assert meeting.meeting_url and "hote@datum.test" in meeting.meeting_url


def test_zoom_failure_is_a_calendar_error_not_a_crash():
    with pytest.raises(CalendarError, match="Zoom"):
        asyncio.run(agenda(Server(zoom_status=429)).book(SLOT, "Jean", advisor_email="a@b.c"))


def test_without_zoom_credentials_the_event_has_no_link():
    meeting = asyncio.run(
        agenda(Server(), zoom_account_id="", zoom_client_id="", zoom_client_secret=None).book(
            SLOT, "Jean", advisor_email="a@b.c"
        )
    )
    assert meeting.meeting_url is None and meeting.zoom_meeting_id is None


def test_unreadable_service_account_is_an_explicit_error():
    bad = Settings(_env_file=None, calendar_provider="google", google_calendar_default_id="c@d.e")
    client = GoogleCalendarClient(
        bad, httpx.AsyncClient(transport=httpx.MockTransport(Server().handler))
    )
    with pytest.raises(CalendarError, match="compte de service"):
        asyncio.run(client.busy("c@d.e", NOW, NOW + timedelta(days=1), "Europe/Paris"))


# --- Démonstration et configuration -------------------------------------------------------------


def test_demo_calendar_gives_fictitious_slots_and_unique_bookings():
    demo = DemoCalendar(Settings(_env_file=None, calendar_provider="demo"))
    slots = asyncio.run(demo.get_available_slots(3))
    assert len(slots) == 3
    a = asyncio.run(demo.book(slots[0], "Jean"))
    b = asyncio.run(demo.book(slots[0], "Jean"))
    assert a.calendar_event_id != b.calendar_event_id
    assert a.meeting_url and "example.com" in a.meeting_url


def test_demo_calendar_is_refused_in_production():
    with pytest.raises(ValueError, match="CALENDAR_PROVIDER=demo"):
        Settings(
            _env_file=None,
            environment="production",
            calendar_provider="demo",
            jwt_secret_key="x" * 40,
            cors_origins=["https://iagora.example.com"],
        )


def test_factory_keeps_unconfigured_by_default():
    assert create_calendar(Settings(_env_file=None)) is None
    assert isinstance(UnconfiguredCalendar(), UnconfiguredCalendar)
    assert isinstance(
        create_calendar(Settings(_env_file=None, calendar_provider="demo")), DemoCalendar
    )


def test_empty_inline_key_falls_back_to_the_file_setting_error():
    empty = Settings(_env_file=None, calendar_provider="google", google_service_account_json="")
    client = GoogleCalendarClient(
        empty, httpx.AsyncClient(transport=httpx.MockTransport(Server().handler))
    )
    with pytest.raises(CalendarError, match="non configuré"):
        asyncio.run(client.busy("c@d.e", NOW, NOW + timedelta(days=1), "Europe/Paris"))
