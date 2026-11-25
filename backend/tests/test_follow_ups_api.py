"""Relances prévues : les voir, les annuler, les décaler (F-16)."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from app.config import get_settings
from app.models import FollowUp
from app.models.enums import FollowUpStatus, UserRole
from app.services.send_window import next_send_time

from .scope_helpers import entrust
from .test_agent_workflow import lead

API = "/api/v1"
PARIS = ZoneInfo("Europe/Paris")


async def _follow_up(session_factory, pid, mid, at, reason="Entretien d'un prospect peu engagé"):
    async with session_factory() as s:
        f = FollowUp(prospect_id=pid, campaign_prospect_id=mid, scheduled_at=at, reason=reason)
        s.add(f)
        await s.commit()
        return f.id


async def _status(session_factory, fid):
    async with session_factory() as s:
        f = await s.get(FollowUp, fid)
        return f.status, f.scheduled_at, f.reason


def test_next_send_time_waits_for_the_window():
    settings = get_settings()
    friday_noon = datetime(2026, 11, 27, 12, tzinfo=PARIS)
    assert next_send_time(friday_noon, settings) == friday_noon
    early = datetime(2026, 11, 26, 6, 30, tzinfo=PARIS)  # jeudi, avant l'ouverture
    assert next_send_time(early, settings) == datetime(2026, 11, 26, 8, tzinfo=PARIS)
    friday_night = datetime(2026, 11, 27, 21, tzinfo=PARIS)  # puis week-end : lundi 8 h
    assert next_send_time(friday_night, settings) == datetime(2026, 11, 30, 8, tzinfo=PARIS)
    weekend = settings.model_copy(update={"follow_up_weekdays_only": False})
    assert next_send_time(friday_night, weekend) == datetime(2026, 11, 28, 8, tzinfo=PARIS)


async def test_prospect_and_global_lists_show_the_next_follow_up_first(client, session_factory):
    pid, mid, _ = await lead(client, "Bonjour")
    later = datetime.now(UTC) + timedelta(days=7)
    sooner = datetime.now(UTC) + timedelta(days=1)
    await _follow_up(session_factory, pid, mid, later, "Relance J+7")
    first = await _follow_up(session_factory, pid, mid, sooner, "Relance J+1")
    done = await _follow_up(session_factory, pid, mid, sooner - timedelta(hours=1))
    async with session_factory() as s:
        (await s.get(FollowUp, done)).status = FollowUpStatus.EXECUTED
        await s.commit()

    r = await client.get(f"{API}/prospects/{pid}/follow-ups")
    assert r.status_code == 200, r.text
    items = r.json()
    assert [i["reason"] for i in items] == ["Relance J+1", "Relance J+7"]  # la partie est exclue
    assert items[0]["id"] == first and items[0]["prospect_name"] == "Jean"
    expected = datetime.fromisoformat(items[0]["expected_at"])
    assert expected >= datetime.fromisoformat(items[0]["scheduled_at"])

    page = (await client.get(f"{API}/follow-ups")).json()
    assert page["total"] == 2 and page["items"][0]["id"] == first


async def test_a_follow_up_outside_the_window_shows_when_it_will_really_leave(
    client, session_factory
):
    pid, mid, _ = await lead(client, "Bonjour")
    # Samedi à 3 h (heure de Paris), au moins une semaine plus tard : départ le lundi à 8 h.
    base = datetime.now(PARIS) + timedelta(days=7)
    saturday = (base + timedelta(days=(5 - base.weekday()) % 7)).replace(
        hour=3, minute=0, second=0, microsecond=0
    )
    await _follow_up(session_factory, pid, mid, saturday)
    item = (await client.get(f"{API}/prospects/{pid}/follow-ups")).json()[0]
    expected = datetime.fromisoformat(item["expected_at"]).astimezone(PARIS)
    assert (expected.weekday(), expected.hour) == (0, 8)


async def test_cancel_stops_this_follow_up_and_keeps_who_did_it(client, session_factory):
    pid, mid, _ = await lead(client, "Bonjour")
    fid = await _follow_up(session_factory, pid, mid, datetime.now(UTC) + timedelta(days=1))
    r = await client.post(f"{API}/follow-ups/{fid}/cancel")
    assert r.status_code == 204, r.text
    status, _, reason = await _status(session_factory, fid)
    assert status is FollowUpStatus.CANCELLED and reason.endswith("annulée par admin-user")
    assert (await client.get(f"{API}/prospects/{pid}/follow-ups")).json() == []
    again = await client.post(f"{API}/follow-ups/{fid}/cancel")
    assert again.status_code == 409 and "déjà partie" in again.json()["detail"]
    assert (await client.post(f"{API}/follow-ups/999999/cancel")).status_code == 404


async def test_reschedule_moves_the_follow_up(client, session_factory):
    pid, mid, _ = await lead(client, "Bonjour")
    fid = await _follow_up(session_factory, pid, mid, datetime.now(UTC) + timedelta(days=1))
    target = (datetime.now(PARIS) + timedelta(days=3)).replace(microsecond=0)
    r = await client.post(
        f"{API}/follow-ups/{fid}/reschedule", json={"scheduled_at": target.isoformat()}
    )
    assert r.status_code == 200, r.text
    assert datetime.fromisoformat(r.json()["scheduled_at"]) == target
    status, at, _ = await _status(session_factory, fid)
    assert status is FollowUpStatus.SCHEDULED
    assert at.replace(tzinfo=at.tzinfo or UTC) == target


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (lambda now: (now - timedelta(hours=1)).isoformat(), "dans le futur"),
        (lambda now: (now + timedelta(days=91)).isoformat(), "90 jours"),
        (lambda now: (now + timedelta(days=1)).replace(tzinfo=None).isoformat(), "fuseau"),
    ],
)
async def test_reschedule_refuses_past_far_or_naive_times(client, session_factory, value, message):
    pid, mid, _ = await lead(client, "Bonjour")
    fid = await _follow_up(session_factory, pid, mid, datetime.now(UTC) + timedelta(days=1))
    r = await client.post(
        f"{API}/follow-ups/{fid}/reschedule", json={"scheduled_at": value(datetime.now(UTC))}
    )
    assert r.status_code == 422 and message in r.text


async def test_a_follow_up_already_sent_cannot_be_moved(client, session_factory):
    pid, mid, _ = await lead(client, "Bonjour")
    fid = await _follow_up(session_factory, pid, mid, datetime.now(UTC) + timedelta(days=1))
    async with session_factory() as s:
        (await s.get(FollowUp, fid)).status = FollowUpStatus.EXECUTED
        await s.commit()
    at = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    r = await client.post(f"{API}/follow-ups/{fid}/reschedule", json={"scheduled_at": at})
    assert r.status_code == 409


async def test_viewer_reads_but_cannot_change(client, make_client, session_factory):
    pid, mid, _ = await lead(client, "Bonjour")
    fid = await _follow_up(session_factory, pid, mid, datetime.now(UTC) + timedelta(days=1))
    viewer = await make_client(UserRole.VIEWER)
    assert len((await viewer.get(f"{API}/prospects/{pid}/follow-ups")).json()) == 1
    assert (await viewer.post(f"{API}/follow-ups/{fid}/cancel")).status_code == 403


async def test_advisor_only_sees_and_changes_follow_ups_in_scope(
    client, make_client, session_factory
):
    pid, mid, _ = await lead(client, "Bonjour")
    fid = await _follow_up(session_factory, pid, mid, datetime.now(UTC) + timedelta(days=1))
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/follow-ups")).json()["total"] == 0
    assert (await advisor.get(f"{API}/prospects/{pid}/follow-ups")).status_code == 404
    r = await advisor.post(f"{API}/follow-ups/{fid}/cancel")
    assert r.status_code == 404 and "Relance introuvable" in r.text
    await entrust(client, advisor, pid)
    assert (await advisor.get(f"{API}/follow-ups")).json()["total"] == 1
    assert (await advisor.post(f"{API}/follow-ups/{fid}/cancel")).status_code == 204


async def test_the_general_list_leaves_fictitious_prospects_out(client, session_factory):
    pid, mid, _ = await lead(client, "Bonjour", email="sim.camille@demo.example.com")
    await _follow_up(session_factory, pid, mid, datetime.now(UTC) + timedelta(days=1))
    assert (await client.get(f"{API}/follow-ups")).json()["total"] == 0
    assert len((await client.get(f"{API}/prospects/{pid}/follow-ups")).json()) == 1
