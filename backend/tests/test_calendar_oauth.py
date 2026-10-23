"""Agenda branché depuis la console : application OAuth Google, connexion de chaque conseiller."""

import json
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from app.api.v1 import calendar as calendar_api
from app.config import Settings, get_settings
from app.core import vault
from app.graph.ports import CalendarNotConfiguredError
from app.main import app
from app.models.enums import UserRole
from app.services import calendar_config
from app.services.agenda import ConsoleCalendar

API = "/api/v1"


def base(**over) -> Settings:
    return Settings(_env_file=None, **over)


class Google:
    """Faux serveurs Google : jetons et agenda."""

    def __init__(self, *, revoked=False):
        self.revoked = revoked
        self.calls: list[tuple[str, dict]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "oauth2.googleapis.com/token" in url:
            self.calls.append(("token", dict(parse_qs(request.content.decode()))))
            if self.revoked:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "acc", "expires_in": 3600})
        if url.endswith("/freeBusy"):
            body = json.loads(request.content)
            self.calls.append(("freebusy", body))
            return httpx.Response(200, json={"calendars": {body["items"][0]["id"]: {"busy": []}}})
        if url.split("?")[0].endswith("/events"):
            self.calls.append(("event", {}))
            return httpx.Response(200, json={"id": "evt-1"})
        return httpx.Response(500)


async def _google_mode(db, settings, default_user_id=None):
    await calendar_config.save(
        db,
        settings,
        {
            "provider": "google",
            "google_client_id": "cid.apps.googleusercontent.com",
            "google_client_secret": "csecret",
            "default_user_id": default_user_id,
        },
        1,
    )


def _calendar(settings, db, google):
    http = httpx.AsyncClient(transport=httpx.MockTransport(google.handler))
    return ConsoleCalendar(settings, lambda: db, http)


async def test_without_any_setting_the_request_is_handed_over(mongo_db):
    with pytest.raises(CalendarNotConfiguredError):
        await _calendar(base(), mongo_db, Google()).get_available_slots(3, advisor_id=2)


async def test_demo_mode_from_the_console_and_refused_in_production(mongo_db):
    await calendar_config.save(mongo_db, base(), {"provider": "demo"}, 1)
    slots = await _calendar(base(), mongo_db, Google()).get_available_slots(3)
    assert len(slots) == 3
    prod = base(
        environment="production", jwt_secret_key="x" * 40, cors_origins=["https://a.example"]
    )
    with pytest.raises(CalendarNotConfiguredError, match="démonstration"):
        await _calendar(prod, mongo_db, Google()).get_available_slots(3)


async def test_slots_come_from_the_connected_advisor_calendar(mongo_db):
    s = base()
    await _google_mode(mongo_db, s)
    await calendar_config.save_connection(mongo_db, s, 7, "refresh-7", "conseil@gmail.com")
    google = Google()
    slots = await _calendar(s, mongo_db, google).get_available_slots(3, advisor_id=7)
    assert len(slots) == 3
    token_call = next(c for c in google.calls if c[0] == "token")
    assert token_call[1]["refresh_token"] == ["refresh-7"]
    assert token_call[1]["client_secret"] == ["csecret"]
    assert next(c for c in google.calls if c[0] == "freebusy")[1]["items"] == [{"id": "primary"}]


async def test_falls_back_to_default_advisor_then_hands_over(mongo_db):
    s = base()
    await _google_mode(mongo_db, s, default_user_id=9)
    with pytest.raises(CalendarNotConfiguredError, match="Mon compte"):
        await _calendar(s, mongo_db, Google()).get_available_slots(3, advisor_id=7)
    await calendar_config.save_connection(mongo_db, s, 9, "refresh-9", "commun@gmail.com")
    google = Google()
    await _calendar(s, mongo_db, google).get_available_slots(3, advisor_id=7)
    assert next(c for c in google.calls if c[0] == "token")[1]["refresh_token"] == ["refresh-9"]


async def test_revoked_authorisation_is_recorded_and_handed_over(mongo_db):
    s = base()
    await _google_mode(mongo_db, s)
    await calendar_config.save_connection(mongo_db, s, 7, "refresh-7", "conseil@gmail.com")
    with pytest.raises(CalendarNotConfiguredError, match="reconnecter"):
        await _calendar(s, mongo_db, Google(revoked=True)).get_available_slots(3, advisor_id=7)
    assert "invalid_grant" in (await calendar_config.get_connection(mongo_db, 7))["last_error"]


async def test_booking_uses_the_advisor_calendar(mongo_db):
    from app.graph.ports import Slot

    s = base()
    await _google_mode(mongo_db, s)
    await calendar_config.save_connection(mongo_db, s, 7, "refresh-7", "conseil@gmail.com")
    google = Google()
    slot = Slot("s", datetime(2099, 1, 5, 10, tzinfo=UTC), datetime(2099, 1, 5, 10, 30, tzinfo=UTC))
    meeting = await _calendar(s, mongo_db, google).book(slot, "Jean", advisor_id=7)
    assert meeting.calendar_event_id == "evt-1"


def test_refresh_tokens_are_stored_encrypted():
    s = base()
    doc = {"refresh_token_enc": vault.encrypt(s, "r-1")}
    assert "r-1" not in doc["refresh_token_enc"]
    assert calendar_config.refresh_token(s, doc) == "r-1"


# --- API ----------------------------------------------------------------------------------------

CONSOLE = "http://localhost:3000"


@pytest.fixture
def settings_override():
    app.dependency_overrides[get_settings] = lambda: base(cors_origins=[CONSOLE])
    yield
    app.dependency_overrides.pop(get_settings, None)


async def test_admin_settings_never_return_the_secret(client, settings_override):
    body = {
        "provider": "google",
        "google_client_id": "cid",
        "google_client_secret": "very-secret",
        "default_user_id": None,
    }
    assert (await client.put(f"{API}/integrations/calendar", json=body)).status_code == 204
    r = await client.get(f"{API}/integrations/calendar")
    assert r.status_code == 200 and "very-secret" not in r.text
    data = r.json()
    assert data["source"] == "console" and data["client_secret_set"] is True
    assert data["redirect_uri"].endswith("/api/v1/calendar/google/callback")
    # Secret vide : celui enregistré est conservé.
    body["google_client_secret"] = None
    await client.put(f"{API}/integrations/calendar", json=body)
    assert (await client.get(f"{API}/integrations/calendar")).json()["client_secret_set"]


async def test_full_connection_flow(make_client, mongo_db, settings_override, monkeypatch):
    admin = await make_client(UserRole.ADMIN)
    advisor = await make_client(UserRole.ADVISOR)
    me = (await advisor.get(f"{API}/auth/me")).json()
    status = (await advisor.get(f"{API}/calendar/me")).json()
    assert status["available"] is False
    refused = await advisor.post(
        f"{API}/calendar/google/connect", json={"return_to": f"{CONSOLE}/account"}
    )
    assert refused.status_code == 409
    await admin.put(
        f"{API}/integrations/calendar",
        json={"provider": "google", "google_client_id": "cid", "google_client_secret": "sec"},
    )
    r = await advisor.post(
        f"{API}/calendar/google/connect", json={"return_to": f"{CONSOLE}/account"}
    )
    url = urlparse(r.json()["url"])
    params = parse_qs(url.query)
    assert url.netloc == "accounts.google.com" and params["client_id"] == ["cid"]
    assert params["access_type"] == ["offline"] and params["login_hint"] == [me["email"]]

    async def fake_exchange(http, client_id, secret, code, redirect_uri):
        assert (client_id, secret, code) == ("cid", "sec", "the-code")
        assert redirect_uri.endswith("/calendar/google/callback")
        return "refresh-xyz", "conseil@gmail.com"

    monkeypatch.setattr(calendar_api.google_oauth, "exchange_code", fake_exchange)
    anon = await make_client(None)
    back = await anon.get(
        f"{API}/calendar/google/callback",
        params={"state": params["state"][0], "code": "the-code"},
    )
    assert back.status_code == 303
    assert back.headers["location"] == f"{CONSOLE}/account?calendar=connected"
    stored = await calendar_config.get_connection(mongo_db, me["id"])
    assert stored["account_email"] == "conseil@gmail.com"
    assert "refresh-xyz" not in str(stored)
    status = (await advisor.get(f"{API}/calendar/me")).json()
    assert status["connected"] and status["account_email"] == "conseil@gmail.com"
    listed = (await admin.get(f"{API}/integrations/calendar")).json()["connections"]
    assert listed[0]["user_id"] == me["id"] and listed[0]["username"]

    revoked = []

    async def fake_revoke(http, token):
        revoked.append(token)

    monkeypatch.setattr(calendar_api.google_oauth, "revoke", fake_revoke)
    assert (await advisor.delete(f"{API}/calendar/me")).status_code == 204
    assert revoked == ["refresh-xyz"]
    assert (await advisor.get(f"{API}/calendar/me")).json()["connected"] is False


async def test_callback_rejects_forged_state_and_open_redirects(make_client, settings_override):
    anon = await make_client(None)
    bad = await anon.get(f"{API}/calendar/google/callback", params={"state": "x", "code": "c"})
    assert bad.status_code == 400
    s = base(cors_origins=[CONSOLE])
    state = calendar_config.make_state(s, 1, "https://evil.example/steal")
    r = await anon.get(f"{API}/calendar/google/callback", params={"state": state, "error": "no"})
    assert r.headers["location"].startswith(f"{CONSOLE}/account?calendar=refused")


async def test_calendar_settings_are_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/integrations/calendar")).status_code == 403
    assert (
        await advisor.put(f"{API}/integrations/calendar", json={"provider": "demo"})
    ).status_code == 403
