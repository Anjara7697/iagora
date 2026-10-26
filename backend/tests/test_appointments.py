"""Lecture des rendez-vous : périodes, filtres, pagination et accès."""

from datetime import UTC, datetime, timedelta

import pytest
from app.models import Appointment, Prospect
from app.models.enums import AppointmentStatus, UserRole
from app.services import appointments
from sqlalchemy import select

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
API = "/api/v1/appointments"


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW

    monkeypatch.setattr(appointments, "datetime", Clock)


async def seed(factory, advisor_id=None):
    async with factory() as session:
        demo = Prospect(first_name="Alice", last_name="Démo", email="alice@demo.example.com")
        other = Prospect(first_name="Test", email="fixture@example.test")
        session.add_all([demo, other])
        await session.flush()

        def row(p, start, end, status="scheduled", advisor=None, url=None):
            return Appointment(
                prospect_id=p.id,
                advisor_id=advisor,
                start_at=NOW + start,
                end_at=NOW + end,
                status=AppointmentStatus(status),
                meeting_url=url,
            )

        rows = [
            row(demo, timedelta(hours=-2), timedelta(hours=-1), advisor=advisor_id),
            row(
                demo,
                timedelta(minutes=-30),
                timedelta(minutes=30),
                advisor=advisor_id,
                url="https://zoom.example/fixture",
            ),
            row(other, timedelta(days=1), timedelta(days=1, hours=1), status="cancelled"),
            row(
                demo,
                timedelta(days=1),
                timedelta(days=1, hours=1),
                advisor=advisor_id,
                url="javascript:alert(1)",
            ),
            row(demo, timedelta(days=-1), timedelta(days=-1, hours=1), status="no_show"),
            row(demo, timedelta(hours=-1), timedelta()),
        ]
        session.add_all(rows)
        await session.commit()
        return [a.id for a in rows]


async def test_periods_stable_order_and_pagination(client, session_factory):
    advisor_id = (await client.get("/api/v1/auth/me")).json()["id"]
    ids = await seed(session_factory, advisor_id)
    response = await client.get(API, params={"limit": 2})
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 4 and page["limit"] == 2 and page["offset"] == 0
    assert [a["id"] for a in page["items"]] == [ids[5], ids[1]]
    ongoing = page["items"][1]
    assert ongoing["advisor_name"] == "admin-user"
    assert ongoing["prospect"]["first_name"] == "Alice"
    assert ongoing["meeting_url"] == "https://zoom.example/fixture"
    assert datetime.fromisoformat(ongoing["start_at"].replace("Z", "+00:00")).tzinfo is not None
    next_page = (await client.get(API, params={"limit": 2, "offset": 2})).json()
    assert [a["id"] for a in next_page["items"]] == [ids[2], ids[3]]
    assert next_page["items"][0]["advisor_name"] is None
    assert next_page["items"][1]["meeting_url"] is None
    past = (await client.get(API, params={"when": "past"})).json()
    assert [a["id"] for a in past["items"]] == [ids[0], ids[4]]
    assert past["items"][0]["status"] == "scheduled"
    assert past["items"][1]["status"] == "no_show"
    async with session_factory() as session:
        assert (await session.get(Appointment, ids[0])).status == AppointmentStatus.SCHEDULED


async def test_combined_filters_and_empty_page(client, session_factory):
    advisor_id = (await client.get("/api/v1/auth/me")).json()["id"]
    ids = await seed(session_factory, advisor_id)
    filtered = (
        await client.get(
            API,
            params={
                "advisor_id": advisor_id,
                "status": "scheduled",
                "limit": 1,
                "offset": 1,
            },
        )
    ).json()
    assert filtered["total"] == 2 and filtered["items"][0]["id"] == ids[3]
    real = (await client.get(API, params={"demo": "exclude"})).json()
    assert real["total"] == 1 and real["items"][0]["status"] == "cancelled"
    empty = (await client.get(API, params={"offset": 100})).json()
    assert empty["items"] == [] and empty["total"] == 4
    no_advisor = (await client.get(API, params={"advisor_id": 999})).json()
    assert no_advisor["items"] == [] and no_advisor["total"] == 0
    async with session_factory() as session:
        assert len((await session.scalars(select(Appointment))).all()) == 6


@pytest.mark.parametrize("role", list(UserRole))
async def test_all_roles_can_consult_without_write_endpoint(make_client, session_factory, role):
    client = await make_client(role)
    await seed(session_factory)
    assert (await client.get(API)).json()["total"] == 4
    assert (await client.post(API, json={})).status_code == 405


async def test_authentication_and_empty_instance(make_client):
    anonymous = await make_client(None)
    assert (await anonymous.get(API)).status_code == 401
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.get(API)).json() == {"items": [], "total": 0, "limit": 25, "offset": 0}


@pytest.mark.parametrize(
    "params",
    [
        {"when": "unknown"},
        {"status": "unknown"},
        {"limit": 0},
        {"limit": 201},
        {"offset": -1},
        {"advisor_id": 0},
        {"demo": "invalid"},
    ],
)
async def test_invalid_filters(client, params):
    assert (await client.get(API, params=params)).status_code == 422
