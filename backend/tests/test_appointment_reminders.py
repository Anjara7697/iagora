"""Rappel du prospect la veille de son rendez-vous (D-47)."""

from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.models import Appointment, Prospect
from app.models.enums import AppointmentStatus, ConsentStatus
from app.services import agent_settings, appointment_reminders
from app.services.agent_settings import AgentMode

from .test_agent_workflow import conversation, lead
from .test_agent_workflow import env as env  # noqa: F401  (fixture)

# Mercredi 3 mars 2027, 10 h à Paris : dans la fenêtre d'envoi.
NOW = datetime(2027, 3, 3, 9, 0, tzinfo=UTC)
SETTINGS = Settings(_env_file=None, follow_up_worker_enabled=False)


async def book(session_factory, pid, *, start, booked_at, status=AppointmentStatus.SCHEDULED):
    async with session_factory() as s:
        appointment = Appointment(
            prospect_id=pid,
            calendar_event_id=f"evt-{start.isoformat()}",
            meeting_url="https://zoom.us/j/42",
            start_at=start,
            end_at=start + timedelta(minutes=30),
            status=status,
            created_at=booked_at,
        )
        s.add(appointment)
        await s.commit()
        return appointment.id


async def run(session_factory, mongo_db, now=NOW):
    return await appointment_reminders.run_due_reminders(
        session_factory, mongo_db, settings=SETTINGS, now=now
    )


async def reminders(client, cid):
    return [
        m
        for m in (await conversation(client, cid))["messages"]
        if (m.get("metadata") or {}).get("mode") == "appointment_reminder"
    ]


async def test_the_prospect_is_reminded_once_the_day_before(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, _, cid = await lead(client, text=None)
    # Jeudi 4 mars, 9 h 30 à Paris ; réservé quatre jours plus tôt.
    start = datetime(2027, 3, 4, 8, 30, tzinfo=UTC)
    await book(session_factory, pid, start=start, booked_at=NOW - timedelta(days=4))

    assert (await run(session_factory, mongo_db, NOW - timedelta(hours=1))).sent == 0  # trop tôt
    assert (await run(session_factory, mongo_db)).sent == 1
    assert (await run(session_factory, mongo_db, NOW + timedelta(hours=2))).sent == 0  # une fois

    [reminder] = await reminders(client, cid)
    assert reminder["role"] == "agent"
    assert "jeudi 4 mars à 9h30 (heure de Paris)" in reminder["content"]
    assert "https://zoom.us/j/42" in reminder["content"]
    assert reminder["content"].startswith("Bonjour Jean,")
    assert reminder["metadata"]["delivery"] == "not_sent"  # prêt à partir sur le canal


async def test_in_assisted_mode_the_reminder_is_not_a_draft(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, _, cid = await lead(client, text=None)
    start = NOW + timedelta(hours=20)
    await book(session_factory, pid, start=start, booked_at=NOW - timedelta(days=2))
    assert (await run(session_factory, mongo_db)).sent == 1
    [reminder] = await reminders(client, cid)
    assert "draft" not in reminder["metadata"]


async def test_no_reminder_in_manual_mode_or_outside_the_send_window(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, _, cid = await lead(client, text=None)
    await book(session_factory, pid, start=NOW + timedelta(hours=20), booked_at=NOW - timedelta(3))
    sunday = datetime(2027, 3, 7, 9, 0, tzinfo=UTC)
    assert (await run(session_factory, mongo_db, sunday)).paused == "hors de la fenêtre d'envoi"
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    assert (await run(session_factory, mongo_db)).paused is not None
    assert await reminders(client, cid) == []


async def test_a_monday_morning_meeting_is_reminded_when_the_window_opens(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, _, cid = await lead(client, text=None)
    # Lundi 8 mars, 10 h à Paris : la veille est un dimanche, hors fenêtre.
    start = datetime(2027, 3, 8, 9, 0, tzinfo=UTC)
    await book(session_factory, pid, start=start, booked_at=NOW)
    monday_8am = datetime(2027, 3, 8, 7, 0, tzinfo=UTC)
    assert (await run(session_factory, mongo_db, monday_8am)).sent == 1
    # À moins de 30 minutes du début, il est trop tard : plus de rappel.
    pid2, _, _ = await lead(client, text=None, email="paul@example.com", first_name="Paul")
    await book(session_factory, pid2, start=monday_8am + timedelta(minutes=20), booked_at=NOW)
    assert (await run(session_factory, mongo_db, monday_8am)).sent == 0


async def test_no_reminder_for_a_late_booking_a_cancelled_meeting_or_an_opt_out(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, _, cid = await lead(client, text=None)
    await book(session_factory, pid, start=NOW + timedelta(hours=20), booked_at=NOW - timedelta(2))
    await book(
        session_factory,
        pid,
        start=NOW + timedelta(hours=21),
        booked_at=NOW - timedelta(days=3),
        status=AppointmentStatus.CANCELLED,
    )
    # Réservé ce matin pour cet après-midi : la confirmation vient de partir.
    late_pid, _, late_cid = await lead(client, text=None, email="late@example.com")
    await book(session_factory, late_pid, start=NOW + timedelta(hours=6), booked_at=NOW)
    async with session_factory() as s:
        prospect = await s.get(Prospect, pid)
        assert prospect is not None
        prospect.consent_status = ConsentStatus.OPTED_OUT
        await s.commit()
    assert (await run(session_factory, mongo_db)).sent == 0
    assert await reminders(client, cid) == [] and await reminders(client, late_cid) == []


async def test_demo_prospects_are_never_reminded(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, _, cid = await lead(client, text=None, email="fictif@demo.example.com")
    await book(session_factory, pid, start=NOW + timedelta(hours=20), booked_at=NOW - timedelta(3))
    assert (await run(session_factory, mongo_db)).sent == 0


async def test_without_an_open_conversation_the_reminder_is_skipped_once(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, _, cid = await lead(client, text=None)
    await mongo_db["conversations"].update_many(
        {"prospect_id": pid}, {"$set": {"status": "closed"}}
    )
    await book(session_factory, pid, start=NOW + timedelta(hours=20), booked_at=NOW - timedelta(3))
    assert (await run(session_factory, mongo_db)).skipped == 1
    assert (await run(session_factory, mongo_db)).skipped == 0  # pas de nouvelle tentative


async def test_in_assisted_mode_the_email_connector_sends_the_reminder_as_is(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    from app.services import email_sync

    from .test_email import FakeEmailClient

    pid, _, cid = await lead(client, text=None, email="jean@acme-corp.com")
    await book(session_factory, pid, start=NOW + timedelta(hours=20), booked_at=NOW - timedelta(3))
    assert (await run(session_factory, mongo_db)).sent == 1
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    transport = FakeEmailClient()
    report = await email_sync.deliver_outbox(
        session_factory,
        mongo_db,
        transport,
        Settings(_env_file=None, email_enabled=True, email_send_enabled=True),
    )
    assert report.sent == 1 and len(transport.sent) == 1
    [reminder] = await reminders(client, cid)
    assert reminder["metadata"]["delivery"] == "sent"
