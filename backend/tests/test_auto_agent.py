"""Déclenchement automatique de l'agent (F-06) et exécution des relances (F-16)."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from app.agents import auto
from app.config import Settings, get_settings
from app.main import app
from app.models import Campaign, CampaignProspect, CampaignSource, FollowUp, Prospect
from app.models.enums import ConsentStatus, ConversionStage, FollowUpStatus
from app.services import agent_settings, drafts, email_sync, follow_ups, pipeline
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError
from bson import ObjectId
from sqlalchemy import delete, select

from .fakes import FakeCalendar, FakeKnowledge
from .test_agent_workflow import conversation, lead, run, say
from .test_agent_workflow import env as env  # noqa: F401  (fixture)
from .test_email import FakeEmailClient

API = "/api/v1"
# Mercredi 3 mars 2027, 10 h à Paris : dans la fenêtre d'envoi des relances.
WEDNESDAY = datetime(2027, 3, 3, 9, 0, tzinfo=UTC)
SUNDAY = datetime(2027, 3, 7, 9, 0, tzinfo=UTC)


def settings(**over):
    return Settings(_env_file=None, agent_auto_reply=True, follow_up_worker_enabled=False, **over)


@pytest.fixture
def auto_reply(env):  # noqa: F811
    app.dependency_overrides[get_settings] = lambda: settings()
    return env


async def agent_messages(client, cid):
    return [m for m in (await conversation(client, cid))["messages"] if m["role"] == "agent"]


# --- Réponse automatique ---


async def test_a_prospect_message_triggers_the_agent_without_a_manual_run(client, auto_reply):
    pid, mid, cid = await lead(client, text=None)
    await say(client, cid, "Bonjour, des infos sur le programme ?")
    replies = await agent_messages(client, cid)
    assert len(replies) == 1 and replies[0]["content"].startswith("Bonjour Jean")


async def test_in_assisted_mode_the_automatic_reply_is_a_draft(client, auto_reply, mongo_db):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, mid, cid = await lead(client, text=None)
    await say(client, cid, "Bonjour")
    reply = (await agent_messages(client, cid))[0]
    assert reply["metadata"]["draft"]["status"] == "pending"


async def test_messages_from_the_agent_or_an_advisor_do_not_trigger_it(client, auto_reply):
    pid, mid, cid = await lead(client, text=None)
    await say(client, cid, "Je suis un conseiller", role="advisor")
    await say(client, cid, "Message de l'agent", role="agent")
    assert len(await agent_messages(client, cid)) == 1  # uniquement celui qu'on a posé


async def test_emergency_stop_accepts_the_message_but_the_agent_stays_silent(
    client, auto_reply, mongo_db
):
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    pid, mid, cid = await lead(client, text=None)
    r = await client.post(
        f"{API}/conversations/{cid}/messages", json={"role": "prospect", "content": "Bonjour"}
    )
    assert r.status_code == 201
    assert await agent_messages(client, cid) == []


async def test_the_feature_can_be_switched_off(client, env):  # noqa: F811
    app.dependency_overrides[get_settings] = lambda: settings() | {}
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, agent_auto_reply=False
    )
    pid, mid, cid = await lead(client, text=None)
    await say(client, cid, "Bonjour")
    assert await agent_messages(client, cid) == []
    assert (await run(client, cid)).status_code == 201  # le déclenchement manuel reste possible


async def test_a_conversation_opened_with_a_prospect_message_triggers_the_agent(client, auto_reply):
    pid, _, _ = await lead(client, text=None, email="paul@example.com")
    r = await client.post(
        f"{API}/conversations",
        json={
            "prospect_id": pid,
            "channel": "email",
            "message": {"role": "prospect", "content": "Bonjour"},
        },
    )
    cid = r.json()["conversation"]["id"]
    assert len(await agent_messages(client, cid)) == 1


async def test_two_simultaneous_triggers_produce_a_single_reply(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await lead(client, "Bonjour")
    deps = {
        "session_factory": session_factory,
        "db": mongo_db,
        "llm": env.llm,
        "calendar": env.calendar,
        "knowledge": env.kb,
    }
    await asyncio.gather(*(auto.reply_to_message(cid, **deps) for _ in range(3)))
    assert len(await agent_messages(client, cid)) == 1


# --- Relances ---


async def silent_prospect(client, session_factory, *, delay=timedelta(days=-1)):
    """Prospect auquel l'agent a répondu et qui ne répond plus, avec une relance échue."""
    pid, mid, cid = await lead(client, "Bonjour")
    await run(client, cid)
    async with session_factory() as s:
        await s.execute(delete(FollowUp).where(FollowUp.prospect_id == pid))  # base propre
        await follow_ups.schedule_follow_up(s, pid, mid, "email", delay, "Test")
    return pid, mid, cid


async def execute(session_factory, mongo_db, env, now=WEDNESDAY, **over):  # noqa: F811
    return await auto.run_due_follow_ups(
        session_factory,
        mongo_db,
        llm=env.llm,
        calendar=FakeCalendar(),
        knowledge=FakeKnowledge(),
        settings=settings(**over),
        now=now,
    )


async def statuses(session_factory, pid):
    async with session_factory() as s:
        rows = await s.scalars(select(FollowUp).where(FollowUp.prospect_id == pid))
        return sorted(r.status.value for r in rows)


async def test_a_due_follow_up_writes_a_reminder_and_schedules_the_next(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    env.llm.reply = "Bonjour Jean, je reviens vers vous pour savoir si vous avez des questions."
    summary = await execute(session_factory, mongo_db, env)
    assert summary.executed == 1 and summary.skipped is None
    messages = await agent_messages(client, cid)
    assert messages[-1]["content"].startswith("Bonjour Jean, je reviens")
    assert messages[-1]["metadata"]["draft"]["status"] == "pending"  # validation humaine
    assert await statuses(session_factory, pid) == ["executed", "scheduled"]  # prochaine relance


async def test_a_follow_up_is_executed_only_once_even_with_concurrent_workers(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    summaries = await asyncio.gather(*(execute(session_factory, mongo_db, env) for _ in range(3)))
    assert sum(s.executed for s in summaries) == 1
    assert len(await agent_messages(client, cid)) == 2  # réponse initiale + une seule relance


async def test_follow_ups_wait_for_the_send_window_and_stop_in_emergency_mode(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    closed = await execute(session_factory, mongo_db, env, now=SUNDAY)
    assert closed.skipped == "hors de la fenêtre d'envoi" and closed.executed == 0
    night = await execute(
        session_factory, mongo_db, env, now=datetime(2027, 3, 3, 20, 30, tzinfo=UTC)
    )
    assert night.skipped is not None
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    stopped = await execute(session_factory, mongo_db, env)
    assert stopped.skipped == "mode manuel (arrêt d'urgence)"
    assert await statuses(session_factory, pid) == ["scheduled"]  # rien n'a été consommé


async def test_a_follow_up_not_yet_due_is_left_alone(client, env, session_factory, mongo_db):  # noqa: F811
    pid, mid, cid = await silent_prospect(client, session_factory, delay=timedelta(days=400))
    assert (await execute(session_factory, mongo_db, env)).executed == 0
    assert await statuses(session_factory, pid) == ["scheduled"]


async def test_no_follow_up_goes_to_an_unsubscribed_prospect(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    async with session_factory() as s:
        s.add_all([])
        prospect = await s.get(Prospect, pid)
        prospect.consent_status = ConsentStatus.OPTED_OUT
        await s.commit()
    summary = await execute(session_factory, mongo_db, env)
    assert summary.executed == 0 and summary.cancelled == 1
    assert await statuses(session_factory, pid) == ["cancelled"]
    assert len(await agent_messages(client, cid)) == 1


async def test_after_the_maximum_number_of_reminders_the_agent_stops(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    async with session_factory() as s:  # trois relances déjà envoyées sans réponse
        for _ in range(3):
            s.add(
                FollowUp(
                    prospect_id=pid,
                    scheduled_at=WEDNESDAY - timedelta(days=2),
                    executed_at=datetime.now(UTC) + timedelta(seconds=1),
                    status=FollowUpStatus.EXECUTED,
                )
            )
        await s.commit()
    summary = await execute(session_factory, mongo_db, env)
    assert summary.executed == 0 and summary.cancelled == 1
    assert len(await agent_messages(client, cid)) == 1


async def test_an_unvalidated_reminder_blocks_the_next_one(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    assert (await execute(session_factory, mongo_db, env)).executed == 1  # brouillon en attente
    async with session_factory() as s:  # la relance suivante arrive avant toute validation
        await follow_ups.schedule_follow_up(s, pid, mid, "email", timedelta(days=-1), "Suite")
    summary = await execute(session_factory, mongo_db, env)
    # la relance ajoutée et celle déjà programmée par l'exécution précédente sont annulées
    assert summary.executed == 0 and summary.cancelled == 2
    assert all("brouillon" in note for note in summary.notes)


async def test_a_reply_cancels_the_scheduled_reminder_so_nothing_is_sent(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    await say(client, cid, "Finalement j'ai une question")  # le prospect répond
    assert (await execute(session_factory, mongo_db, env)).executed == 0
    assert await statuses(session_factory, pid) == ["cancelled"]


def test_send_window_is_weekdays_in_paris_time():
    s = settings()
    assert auto.in_send_window(WEDNESDAY, s)
    assert not auto.in_send_window(SUNDAY, s)
    assert not auto.in_send_window(datetime(2027, 3, 3, 6, 59, tzinfo=UTC), s)  # 7 h 59
    assert auto.in_send_window(datetime(2027, 3, 3, 7, 0, tzinfo=UTC), s)  # 8 h 00
    assert auto.in_send_window(datetime(2027, 3, 3, 17, 59, tzinfo=UTC), s)  # 18 h 59
    assert not auto.in_send_window(datetime(2027, 3, 3, 18, 0, tzinfo=UTC), s)  # 19 h 00


async def test_a_manual_run_after_the_automatic_reply_is_a_harmless_conflict(client, auto_reply):
    pid, mid, cid = await lead(client, text=None)
    await say(client, cid, "Bonjour")  # l'agent répond tout seul
    again = await run(client, cid)
    assert again.status_code == 409 and "Aucun message du prospect" in again.json()["detail"]
    assert len(await agent_messages(client, cid)) == 1


async def test_weekend_window_can_be_opened_for_trials():
    open_all = settings(
        follow_up_window_start_hour=0, follow_up_window_end_hour=24, follow_up_weekdays_only=False
    )
    assert auto.in_send_window(SUNDAY, open_all)


@pytest.mark.parametrize("stage", ["converted", "lost"])
@pytest.mark.parametrize("via_api", [True, False])
async def test_terminal_stage_cancels_pending_reminders_atomically(
    client, env, session_factory, mongo_db, stage, via_api
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    if via_api:
        response = await client.patch(
            f"{API}/campaign-prospects/{mid}",
            json={"conversion_stage": stage, "reason": "Fin du parcours"},
        )
        assert response.status_code == 200, response.text
    else:
        async with session_factory() as s:
            await pipeline.change_stage(s, mid, ConversionStage(stage), "Fin du parcours")
    assert await statuses(session_factory, pid) == ["cancelled"]
    assert (await execute(session_factory, mongo_db, env)).executed == 0
    assert len(await agent_messages(client, cid)) == 1
    async with session_factory() as s:
        with pytest.raises(ConflictError, match="converti ou perdu"):
            await follow_ups.schedule_follow_up(s, pid, mid, "email", timedelta(days=1), "Suite")


@pytest.mark.parametrize("stage", [ConversionStage.CONVERTED, ConversionStage.LOST])
@pytest.mark.parametrize("unbound", [True, False])
async def test_worker_rejects_legacy_reminders_for_terminal_context(
    client, env, session_factory, mongo_db, stage, unbound
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    async with session_factory() as s:
        membership = await s.get(CampaignProspect, mid)
        membership.conversion_stage = stage  # ancien état, sans passer par le service
        reminder = await s.scalar(select(FollowUp).where(FollowUp.prospect_id == pid))
        if unbound:
            reminder.campaign_prospect_id = None
        await s.commit()
    summary = await execute(session_factory, mongo_db, env)
    assert summary.executed == 0 and summary.cancelled == 1
    assert "parcours converti ou perdu" in summary.notes[0]
    assert await statuses(session_factory, pid) == ["cancelled"]
    assert len(await agent_messages(client, cid)) == 1


async def add_other_membership(session_factory, pid, mid):
    async with session_factory() as s:
        old = await s.get(CampaignProspect, mid)
        source = await s.get(CampaignSource, old.campaign_source_id)
        campaign = Campaign(name="Autre campagne")
        s.add(campaign)
        await s.flush()
        link = CampaignSource(campaign_id=campaign.id, source_id=source.source_id)
        s.add(link)
        await s.flush()
        other = CampaignProspect(
            prospect_id=pid,
            campaign_source_id=link.id,
            last_seen_at=datetime.now(UTC) + timedelta(minutes=1),
        )
        s.add(other)
        await s.commit()
        return other.id


async def test_converting_one_membership_preserves_another_campaigns_reminder(
    client, env, session_factory, mongo_db
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    other_id = await add_other_membership(session_factory, pid, mid)
    async with session_factory() as s:
        await follow_ups.schedule_follow_up(s, pid, other_id, "email", timedelta(days=-1), "Autre")
        await pipeline.change_stage(s, mid, ConversionStage.CONVERTED, "Inscription")
    assert await statuses(session_factory, pid) == ["cancelled", "scheduled"]
    assert (await execute(session_factory, mongo_db, env)).executed == 1


async def test_old_reminder_cannot_run_in_a_different_campaign(
    client, env, session_factory, mongo_db
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    await add_other_membership(session_factory, pid, mid)
    summary = await execute(session_factory, mongo_db, env)
    assert summary.executed == 0 and summary.cancelled == 1
    assert "contexte commercial a changé" in summary.notes[0]
    assert len(await agent_messages(client, cid)) == 1


async def test_inbound_message_after_conversion_does_not_schedule_a_new_reminder(
    client, env, session_factory
):
    pid, mid, cid = await lead(client, "Bonjour")
    async with session_factory() as s:
        await pipeline.change_stage(s, mid, ConversionStage.CONVERTED, "Inscription")
    response = await run(client, cid)
    assert response.status_code == 201, response.text
    assert await statuses(session_factory, pid) == []
    assert (await client.get(f"{API}/campaign-prospects/{mid}")).json()[
        "conversion_stage"
    ] == "converted"


@pytest.mark.parametrize("assisted", [False, True])
async def test_prepared_reminder_is_blocked_before_smtp_after_conversion(
    client, env, session_factory, mongo_db, assisted
):
    pid, mid, cid = await silent_prospect(client, session_factory)
    async with session_factory() as s:
        prospect = await s.get(Prospect, pid)
        prospect.email = "jean@acme-corp.com"
        await s.commit()
    if assisted:
        await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    assert (await execute(session_factory, mongo_db, env)).executed == 1
    reminder = (await agent_messages(client, cid))[-1]
    if assisted:
        await drafts.approve(mongo_db, cid, reminder["id"], 1, None)
        reminder = (await agent_messages(client, cid))[-1]
    assert reminder["metadata"]["follow_up"]["membership_id"] == mid
    async with session_factory() as s:
        await pipeline.change_stage(s, mid, ConversionStage.CONVERTED, "Inscription")
    # Isoler la relance du premier message commercial déjà écrit.
    await mongo_db["conversations"].update_one(
        {"_id": ObjectId(cid)},
        {"$set": {"messages": [reminder]}},
    )
    transport = FakeEmailClient()
    report = await email_sync.deliver_outbox(
        session_factory,
        mongo_db,
        transport,
        Settings(_env_file=None, email_enabled=True, email_send_enabled=True),
    )
    assert report.blocked == 1 and report.sent == 0
    assert transport.sent == []
