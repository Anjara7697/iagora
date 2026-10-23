"""Zoom branché depuis la console : compte de l'école ou compte de chaque conseiller."""

import json
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from app.api.v1 import zoom as zoom_api
from app.config import Settings, get_settings
from app.graph.ports import Slot
from app.main import app
from app.models.enums import UserRole
from app.services import calendar_config, zoom_config
from app.services.agenda import ConsoleCalendar

API = "/api/v1"
SLOT = Slot("s", datetime(2099, 1, 5, 10, tzinfo=UTC), datetime(2099, 1, 5, 10, 30, tzinfo=UTC))


def base(**over) -> Settings:
    return Settings(_env_file=None, **over)


class Servers:
    """Faux Google (agenda) et Zoom."""

    def __init__(self, *, zoom_refresh_fails=False):
        self.zoom_refresh_fails = zoom_refresh_fails
        self.calls: list[tuple[str, object]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "oauth2.googleapis.com/token" in url:
            return httpx.Response(200, json={"access_token": "g", "expires_in": 3600})
        if url.endswith("/freeBusy"):
            body = json.loads(request.content)
            return httpx.Response(200, json={"calendars": {body["items"][0]["id"]: {"busy": []}}})
        if url.split("?")[0].endswith("/events"):
            return httpx.Response(200, json={"id": "evt-1"})
        if "zoom.us/oauth/token" in url:
            form = parse_qs(request.content.decode()) or parse_qs(urlparse(url).query)
            self.calls.append(("zoom-token", form))
            if self.zoom_refresh_fails:
                return httpx.Response(400, json={"reason": "Invalid Token!"})
            return httpx.Response(
                200, json={"access_token": "z", "refresh_token": "rotated", "expires_in": 3600}
            )
        if "api.zoom.us/v2/users/" in url:
            host = url.split("/users/")[1].split("/")[0]
            self.calls.append(("zoom-meeting", host))
            return httpx.Response(201, json={"id": 42, "join_url": f"https://zoom.us/j/42?{host}"})
        return httpx.Response(500)


async def _setup(db, s, zoom_mode, **zoom):
    await calendar_config.save(
        db, s, {"provider": "google", "google_client_id": "g", "google_client_secret": "gs"}, 1
    )
    await calendar_config.save_connection(db, s, 7, "g-refresh", "conseil@gmail.com")
    await zoom_config.save(db, s, {"mode": zoom_mode, **zoom}, 1)


def _calendar(s, db, servers):
    http = httpx.AsyncClient(transport=httpx.MockTransport(servers.handler))
    return ConsoleCalendar(s, lambda: db, http)


async def test_school_account_creates_meeting_for_the_advisor(mongo_db):
    s = base()
    await _setup(
        mongo_db, s, "account", account_id="acc", client_id="cid", client_secret="sec",
        host_user="hote@ecole.fr",
    )  # fmt: skip
    servers = Servers()
    meeting = await _calendar(s, mongo_db, servers).book(
        SLOT, "Jean", advisor_email="conseil@ecole.fr", advisor_id=7
    )
    assert meeting.meeting_url and "conseil@ecole.fr" in meeting.meeting_url
    assert ("zoom-meeting", "conseil@ecole.fr") in servers.calls


async def test_advisor_own_zoom_is_used_and_refresh_token_rotated(mongo_db):
    s = base()
    await _setup(mongo_db, s, "advisor", client_id="cid", client_secret="sec")
    await zoom_config.save_connection(mongo_db, s, 7, "z-refresh-1", "conseil@zoom.fr")
    servers = Servers()
    meeting = await _calendar(s, mongo_db, servers).book(SLOT, "Jean", advisor_id=7)
    assert meeting.meeting_url and ("zoom-meeting", "me") in servers.calls
    token_call = next(c for c in servers.calls if c[0] == "zoom-token")
    assert token_call[1]["refresh_token"] == ["z-refresh-1"]
    stored = await zoom_config.get_connection(mongo_db, 7)
    assert zoom_config.refresh_token(s, stored) == "rotated"


async def test_advisor_without_zoom_gets_a_meeting_without_link(mongo_db):
    s = base()
    await _setup(mongo_db, s, "advisor", client_id="cid", client_secret="sec")
    servers = Servers()
    meeting = await _calendar(s, mongo_db, servers).book(SLOT, "Jean", advisor_id=7)
    assert meeting.meeting_url is None and meeting.calendar_event_id == "evt-1"


async def test_revoked_zoom_is_recorded(mongo_db):
    from app.graph.ports import CalendarError

    s = base()
    await _setup(mongo_db, s, "advisor", client_id="cid", client_secret="sec")
    await zoom_config.save_connection(mongo_db, s, 7, "z-refresh-1", "conseil@zoom.fr")
    with pytest.raises(CalendarError):
        await _calendar(s, mongo_db, Servers(zoom_refresh_fails=True)).book(
            SLOT, "Jean", advisor_id=7
        )
    assert (await zoom_config.get_connection(mongo_db, 7))["last_error"]


async def test_mode_none_books_without_link(mongo_db):
    s = base()
    await _setup(mongo_db, s, "none")
    meeting = await _calendar(s, mongo_db, Servers()).book(SLOT, "Jean", advisor_id=7)
    assert meeting.meeting_url is None


# --- API ----------------------------------------------------------------------------------------

CONSOLE = "http://localhost:3000"


@pytest.fixture
def settings_override():
    app.dependency_overrides[get_settings] = lambda: base(cors_origins=[CONSOLE])
    yield
    app.dependency_overrides.pop(get_settings, None)


async def test_admin_settings_validation_and_secret(client, settings_override):
    url = f"{API}/integrations/zoom"
    assert (await client.put(url, json={"mode": "account", "client_id": "c"})).status_code == 422
    body = {"mode": "account", "account_id": "a", "client_id": "c", "client_secret": "top-secret"}
    assert (await client.put(url, json=body)).status_code == 204
    r = await client.get(url)
    assert "top-secret" not in r.text and r.json()["client_secret_set"] is True
    assert r.json()["redirect_uri"].endswith("/api/v1/zoom/callback")


async def test_advisor_connects_own_zoom(make_client, mongo_db, settings_override, monkeypatch):
    admin = await make_client(UserRole.ADMIN)
    advisor = await make_client(UserRole.ADVISOR)
    me = (await advisor.get(f"{API}/auth/me")).json()
    ret = {"return_to": f"{CONSOLE}/account"}
    assert (await advisor.post(f"{API}/zoom/connect", json=ret)).status_code == 409
    await admin.put(
        f"{API}/integrations/zoom",
        json={"mode": "advisor", "client_id": "cid", "client_secret": "sec"},
    )
    url = urlparse((await advisor.post(f"{API}/zoom/connect", json=ret)).json()["url"])
    params = parse_qs(url.query)
    assert url.netloc == "zoom.us" and params["client_id"] == ["cid"]

    async def fake_exchange(http, client_id, secret, code, redirect_uri):
        return "access", "refresh-1", 3600

    async def fake_email(http, access):
        return "paul@zoom.example"

    monkeypatch.setattr(zoom_api.zoom_oauth, "exchange_code", fake_exchange)
    monkeypatch.setattr(zoom_api.zoom_oauth, "account_email", fake_email)
    anon = await make_client(None)
    back = await anon.get(f"{API}/zoom/callback", params={"state": params["state"][0], "code": "c"})
    assert back.headers["location"] == f"{CONSOLE}/account?zoom=connected"
    status = (await advisor.get(f"{API}/zoom/me")).json()
    assert status["connected"] and status["account_email"] == "paul@zoom.example"
    # Un état d'agenda ne vaut pas pour Zoom (usage dédié).
    cal_state = calendar_config.make_state(base(cors_origins=[CONSOLE]), me["id"], CONSOLE)
    assert (
        await anon.get(f"{API}/zoom/callback", params={"state": cal_state, "code": "c"})
    ).status_code == 400
    assert (await advisor.delete(f"{API}/zoom/me")).status_code == 204
    assert (await advisor.get(f"{API}/zoom/me")).json()["connected"] is False


async def test_zoom_settings_are_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/integrations/zoom")).status_code == 403
