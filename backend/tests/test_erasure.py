"""Droit à l'effacement (RGPD, art. 17), liste de suppression et durée de conservation."""

from datetime import UTC, datetime, timedelta

import pytest
from app import privacy_commands
from app.models import (
    Appointment,
    CampaignProspect,
    ConsentEvent,
    ErasureRecord,
    FollowUp,
    Interaction,
    Prospect,
)
from app.models.enums import AppointmentStatus, ConversionStage, UserRole
from app.services import erasure
from sqlalchemy import func, select, update

from .test_demo import API, conversation_for, make

NOW = datetime(2026, 10, 29, 10, 0, tzinfo=UTC)


async def count(factory, model) -> int:
    async with factory() as s:
        return int(await s.scalar(select(func.count()).select_from(model)) or 0)


async def seed_data(client, factory, mongo_db, email="marie@acme-corp.com"):
    """Un prospect avec conversation, trace de l'agent, rendez-vous et relance."""
    pid = await make(client, email, "Marie")
    await conversation_for(client, pid)
    await mongo_db["agent_runs"].insert_one({"prospect_id": pid, "action": "reply"})
    await mongo_db["agent_events"].insert_one({"prospect_id": pid, "kind": "x"})
    async with factory() as s:
        s.add(
            Appointment(
                prospect_id=pid,
                start_at=NOW + timedelta(days=2),
                end_at=NOW + timedelta(days=2, minutes=30),
                status=AppointmentStatus.SCHEDULED,
                calendar_event_id="evt-1",
                zoom_meeting_id="zoom-1",
                meeting_url="https://zoom.example/j/1",
            )
        )
        s.add(FollowUp(prospect_id=pid, scheduled_at=NOW + timedelta(days=3)))
        await s.commit()
    return pid


def erase(client, pid, confirm="marie@acme-corp.com", reason="request"):
    return client.post(f"{API}/prospects/{pid}/erase", json={"reason": reason, "confirm": confirm})


async def test_erasure_removes_everything_about_the_person(client, session_factory, mongo_db):
    pid = await seed_data(client, session_factory, mongo_db)
    other = await make(client, "autre@acme-corp.com", "Autre")
    await conversation_for(client, other)

    r = await erase(client, pid)
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["conversations"] == 1 and report["appointments"] == 1
    assert report["interactions"] >= 1 and report["suppressed"] is True
    assert report["external_events"][0]["calendar_event_id"] == "evt-1"
    assert report["external_events"][0]["meeting_url"] == "https://zoom.example/j/1"

    assert (await client.get(f"{API}/prospects/{pid}")).status_code == 404
    for name in ("conversations", "agent_runs", "agent_events"):
        assert await mongo_db[name].count_documents({"prospect_id": pid}) == 0
    async with session_factory() as s:
        for model in (Appointment, FollowUp, ConsentEvent):
            n = await s.scalar(
                select(func.count()).select_from(model).where(model.prospect_id == pid)
            )
            assert n == 0
        assert (
            await s.scalar(
                select(func.count()).select_from(Interaction).where(Interaction.prospect_id == pid)
            )
            == 0
        )
    # Les données des autres prospects restent intactes.
    assert await mongo_db["conversations"].count_documents({"prospect_id": other}) == 1
    assert (await client.get(f"{API}/prospects/{other}")).status_code == 200


async def test_erasure_needs_the_email_as_confirmation(client, session_factory, mongo_db):
    pid = await seed_data(client, session_factory, mongo_db)
    assert (await erase(client, pid, confirm="mauvaise@adresse.fr")).status_code == 422
    assert (await client.get(f"{API}/prospects/{pid}")).status_code == 200
    assert (await erase(client, pid, confirm="  MARIE@acme-corp.com ")).status_code == 200


async def test_prospect_without_email_is_confirmed_by_its_number(client, session_factory):
    async with session_factory() as s:
        prospect = Prospect(first_name="Sans", last_name="Email", phone="+33600000001")
        s.add(prospect)
        await s.commit()
        pid = prospect.id
    assert (await erase(client, pid, confirm="x")).status_code == 422
    assert (await erase(client, pid, confirm=str(pid))).status_code == 200


async def test_erasure_is_admin_only_and_unknown_prospect_is_404(make_client, client):
    pid = await make(client, "marie@acme-corp.com")
    for role in (UserRole.ADVISOR, UserRole.VIEWER):
        other = await make_client(role)
        assert (await erase(other, pid)).status_code == 403
    assert (await client.get(f"{API}/prospects/{pid}")).status_code == 200
    assert (await erase(client, 9999)).status_code == 404


async def test_erased_person_is_not_contacted_again_by_a_new_import(
    client, session_factory, mongo_db
):
    pid = await seed_data(client, session_factory, mongo_db)
    await erase(client, pid, reason="request")
    again = await client.post(
        f"{API}/prospects",
        json={
            "first_name": "Marie",
            "email": "MARIE@acme-corp.com",
            "consent_granted": True,
            "consent_source": "import",
        },
    )
    assert again.status_code == 201, again.text
    assert again.json()["prospect"]["consent_status"] == "opted_out"
    async with session_factory() as s:
        record = await s.scalar(select(ErasureRecord))
        assert record is not None and record.keep_suppressed and record.email_hash
        assert "marie" not in (record.email_hash or "")  # aucune donnée lisible conservée


async def test_other_reason_without_opt_out_keeps_no_trace_of_the_person(
    client, session_factory, mongo_db
):
    pid = await seed_data(client, session_factory, mongo_db)
    await erase(client, pid, reason="other")
    async with session_factory() as s:
        record = await s.scalar(select(ErasureRecord))
        assert record is not None and not record.keep_suppressed
        assert record.email_hash is None and record.phone_hash is None
    again = await make(client, "marie@acme-corp.com")
    detail = (await client.get(f"{API}/prospects/{again}")).json()
    assert detail["consent_status"] != "opted_out"


async def test_an_opted_out_person_stays_suppressed_after_erasure(client, session_factory):
    pid = await make(client, "stop@acme-corp.com")
    assert (
        await client.post(f"{API}/prospects/{pid}/opt-out", json={"source": "email"})
    ).status_code == 200
    assert (
        await erase(client, pid, confirm="stop@acme-corp.com", reason="other")
    ).status_code == 200
    async with session_factory() as s:
        assert await erasure.is_suppressed(s, email="STOP@acme-corp.com", phone=None)
        assert not await erasure.is_suppressed(s, email="autre@acme-corp.com", phone=None)
    back = await make(client, "stop@acme-corp.com")
    assert (await client.get(f"{API}/prospects/{back}")).json()["consent_status"] == "opted_out"


def test_fingerprints_ignore_case_spaces_and_phone_format():
    assert erasure.fingerprint(" Marie@Acme.fr ") == erasure.fingerprint("marie@acme.fr")
    assert erasure.fingerprint("+33 6 00 00 00 01", phone=True) == erasure.fingerprint(
        "+33600000001", phone=True
    )
    assert erasure.fingerprint(None) is None and erasure.fingerprint("  ") is None
    assert erasure.fingerprint("a@b.fr") != erasure.fingerprint("c@d.fr")


# --- Durée de conservation -----------------------------------------------------------------------


async def backdate(factory, pid, days):
    old = NOW - timedelta(days=days)
    async with factory() as s:
        await s.execute(
            update(Prospect).where(Prospect.id == pid).values(created_at=old, updated_at=old)
        )
        await s.execute(
            update(Interaction).where(Interaction.prospect_id == pid).values(created_at=old)
        )
        await s.commit()


async def inactive(factory, days=365):
    async with factory() as s:
        found = await erasure.inactive_prospects(s, older_than_days=days, now=NOW)
    return {item.prospect_id for item in found}


async def test_only_really_inactive_prospects_are_selected(client, session_factory, mongo_db):
    old = await make(client, "ancien@acme-corp.com")
    await conversation_for(client, old)
    recent = await make(client, "recent@acme-corp.com")
    await conversation_for(client, recent)
    with_meeting = await make(client, "rdv@acme-corp.com")
    with_follow_up = await make(client, "relance@acme-corp.com")
    for pid in (old, with_meeting, with_follow_up):
        await backdate(session_factory, pid, 400)
    async with session_factory() as s:
        s.add(
            Appointment(
                prospect_id=with_meeting,
                start_at=NOW + timedelta(days=1),
                end_at=NOW + timedelta(days=1, minutes=30),
                status=AppointmentStatus.SCHEDULED,
            )
        )
        s.add(FollowUp(prospect_id=with_follow_up, scheduled_at=NOW + timedelta(days=1)))
        await s.commit()
    # `recent` a un message daté de maintenant : son activité est récente.
    async with session_factory() as s:
        await s.execute(
            update(Prospect)
            .where(Prospect.id == recent)
            .values(created_at=NOW - timedelta(days=400))
        )
        await s.commit()
    assert await inactive(session_factory) == {old}


async def test_converted_prospects_are_kept_unless_asked(client, session_factory):
    pid = await make(client, "diplome@acme-corp.com")
    await backdate(session_factory, pid, 400)
    async with session_factory() as s:
        membership = await s.scalar(
            select(CampaignProspect).where(CampaignProspect.prospect_id == pid)
        )
        if membership is None:  # fiche sans campagne : on lui en donne une pour porter l'étape
            from app.models import Campaign, CampaignSource, Source

            campaign = Campaign(name="C", status="active")
            source = Source(name="S", type="form", platform="web")
            s.add_all([campaign, source])
            await s.flush()
            link = CampaignSource(campaign_id=campaign.id, source_id=source.id)
            s.add(link)
            await s.flush()
            membership = CampaignProspect(campaign_source_id=link.id, prospect_id=pid)
            s.add(membership)
        membership.conversion_stage = ConversionStage.CONVERTED
        await s.commit()
    assert await inactive(session_factory) == set()
    async with session_factory() as s:
        found = await erasure.inactive_prospects(
            s, older_than_days=365, include_converted=True, now=NOW
        )
    assert {i.prospect_id for i in found} == {pid}


@pytest.fixture
def cli(monkeypatch, session_factory, mongo_db):
    monkeypatch.setattr(privacy_commands, "get_sessionmaker", lambda: session_factory)
    monkeypatch.setattr(privacy_commands, "get_mongo_db", lambda: mongo_db)

    async def noop():
        return None

    monkeypatch.setattr(privacy_commands, "dispose_engine", noop)
    monkeypatch.setattr(privacy_commands, "close_clients", noop)


async def test_purge_command_previews_by_default_then_erases(
    client, session_factory, mongo_db, cli, capsys
):
    pid = await seed_data(client, session_factory, mongo_db)
    # Prospect très ancien, sans rendez-vous ni relance à venir.
    async with session_factory() as s:
        await s.execute(delete_all(Appointment))
        await s.execute(delete_all(FollowUp))
        await s.commit()
    old = datetime.now(UTC) - timedelta(days=500)
    async with session_factory() as s:
        await s.execute(
            update(Prospect).where(Prospect.id == pid).values(created_at=old, updated_at=old)
        )
        await s.execute(update(Interaction).values(created_at=old))
        await s.commit()

    assert await privacy_commands.cmd_purge_inactive(365, include_converted=False, apply=False) == 0
    out = capsys.readouterr().out
    assert "1 prospect(s) inactif(s)" in out and "Aperçu seulement" in out
    assert "marie" not in out.lower() and "acme" not in out.lower()  # jamais de donnée lisible
    assert await count(session_factory, Prospect) == 1

    assert await privacy_commands.cmd_purge_inactive(365, include_converted=False, apply=True) == 0
    assert "effacé(s)" in capsys.readouterr().out
    assert await count(session_factory, Prospect) == 0
    assert await mongo_db["conversations"].count_documents({}) == 0
    async with session_factory() as s:
        record = await s.scalar(select(ErasureRecord))
        assert record is not None and record.reason == "retention" and record.actor_user_id is None
        assert not record.keep_suppressed  # inactif et jamais désinscrit : aucune empreinte gardée


async def test_purge_command_refuses_a_dangerously_short_retention(cli, capsys):
    assert await privacy_commands.cmd_purge_inactive(7, include_converted=False, apply=True) == 1
    assert "durée minimale" in capsys.readouterr().out


def delete_all(model):
    from sqlalchemy import delete

    return delete(model)
