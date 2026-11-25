"""Journal en direct de l'agent : étapes, attente dans la file, confidentialité."""

from datetime import UTC, datetime, timedelta

import pytest
from app.config import Settings, get_settings
from app.core.agent_mode import AgentMode
from app.main import app
from app.services import agent_activity, agent_events, agent_settings

from .test_agent_workflow import INTRO, lead, run, say
from .test_agent_workflow import env as env  # noqa: F401  (fixture)

API = "/api/v1"
NOW = datetime(2027, 3, 3, 9, 0, tzinfo=UTC)


async def activity(client, cid):
    r = await client.get(f"{API}/conversations/{cid}/agent-activity")
    assert r.status_code == 200, r.text
    return r.json()


async def test_a_finished_run_shows_its_steps_with_fixed_labels(client, env):  # noqa: F811
    pid, mid, cid = await lead(client, text="Bonjour, des infos sur le programme ?")
    assert (await run(client, cid)).status_code == 201

    a = await activity(client, cid)
    assert a["state"] == "done" and a["prospect_id"] == pid
    labels = [s["label"] for s in a["steps"]]
    assert labels[:4] == [
        "Lecture de la fiche du prospect",
        "Lecture de la conversation et de la campagne",
        "Mise à jour du profil",
        "Analyse du message",
    ]
    assert labels[-1] == "Mise à jour de l'étape commerciale"
    assert all(s["status"] == "done" and s["finished_at"] for s in a["steps"])
    allowed = set(agent_activity.STEP_LABELS.values()) | {agent_activity.DRAFT_LABEL}
    assert set(labels) <= allowed
    # Ni la réponse rédigée, ni le message du prospect, ni la justification : des libellés fixes.
    text = str(a)
    assert INTRO[:30] not in text and "des infos sur le programme" not in text


async def test_in_assisted_mode_the_step_says_a_draft_is_saved(client, env, mongo_db):  # noqa: F811
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, mid, cid = await lead(client)
    assert (await run(client, cid)).status_code == 201
    labels = [s["label"] for s in (await activity(client, cid))["steps"]]
    assert agent_activity.DRAFT_LABEL in labels and "Envoi du message" not in labels


async def test_nothing_to_show_on_a_quiet_conversation(client, env):  # noqa: F811
    pid, mid, cid = await lead(client, text=None)
    assert await activity(client, cid) is None


async def test_a_grouped_email_waits_and_is_listed_as_current_activity(
    client,
    env,  # noqa: F811
    mongo_db,
):
    pid, mid, cid = await lead(client)
    await agent_events.enqueue_reply(mongo_db, cid, delay=timedelta(minutes=2))

    a = await activity(client, cid)
    assert a["state"] == "waiting" and a["waiting_reason"] == "grouping"
    assert a["next_attempt_at"] is not None

    current = (await client.get(f"{API}/agent/activity")).json()
    assert [(i["conversation_id"], i["state"]) for i in current] == [(cid, "waiting")]
    assert current[0]["prospect"]["first_name"] == "Jean"


async def test_in_manual_mode_the_waiting_message_says_why(client, env, mongo_db):  # noqa: F811
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, agent_auto_reply=True, follow_up_worker_enabled=False
    )
    await agent_settings.set_mode(mongo_db, AgentMode.MANUAL, None)
    pid, mid, cid = await lead(client, text=None)
    await say(client, cid, "Bonjour")
    a = await activity(client, cid)
    assert a["state"] == "waiting" and a["waiting_reason"] == "manual_mode"


async def test_current_activity_respects_the_scope(client, env, mongo_db, session_factory):  # noqa: F811
    pid, mid, cid = await lead(client)
    await agent_events.enqueue_reply(mongo_db, cid, delay=timedelta(minutes=2))
    async with session_factory() as session:
        assert await agent_activity.active(session, mongo_db, {"prospect_id": {"$in": []}}) == []
        assert len(await agent_activity.active(session, mongo_db, {})) == 1


def _activity(**over):
    return {
        "conversation_id": "c1",
        "prospect_id": 1,
        "run_state": "running",
        "started_at": NOW - timedelta(seconds=10),
        "updated_at": NOW - timedelta(seconds=2),
        "steps": [
            {
                "node": "qualify_prospect",
                "label": "Analyse du message",
                "status": "running",
                "started_at": NOW - timedelta(seconds=2),
            }
        ],
    } | over


def _event(**over):
    return {"conversation_id": "c1", "prospect_id": 1, "completed": False} | over


@pytest.mark.parametrize(
    ("activity_doc", "pending", "failed", "state"),
    [
        (_activity(), None, None, "running"),
        # Une exécution en cours prime sur l'entrée de la file qui l'a déclenchée.
        (_activity(), _event(next_attempt_at=NOW + timedelta(seconds=50)), None, "running"),
        # Plus de nouvelles depuis 3 min : processus redémarré pendant le traitement.
        (_activity(updated_at=NOW - timedelta(minutes=4)), None, None, "stalled"),
        (None, _event(next_attempt_at=NOW - timedelta(seconds=1)), None, "queued"),
        (_activity(run_state="error", finished_at=NOW), _event(errors=1), None, "retrying"),
        (None, None, {"completed_at": NOW - timedelta(hours=1), "prospect_id": 1}, "failed"),
        (_activity(run_state="done", finished_at=NOW - timedelta(minutes=1)), None, None, "done"),
        (_activity(run_state="done", finished_at=NOW - timedelta(minutes=11)), None, None, None),
        (None, None, None, None),
    ],
)
def test_describe_combines_the_run_and_the_queue(activity_doc, pending, failed, state):
    result = agent_activity.describe(activity_doc, pending, failed, now=NOW)
    assert (result.state if result else None) == state


def test_the_details_never_carry_free_text():
    class Decision:
        class action:  # noqa: N801
            value = "propose_meeting"

    assert agent_activity._detail("decide_next_action", {"decision": Decision}) == (
        "proposer un rendez-vous"
    )
    reply = {"reply_text": "Texte secret", "reply_metadata": {"sources": ["a", "b"]}}
    assert agent_activity._detail("generate_response", reply) == ("2 extraits de la base utilisés")
    assert agent_activity._detail("get_calendar_slots", {"slots": [1]}) == "1 créneau disponible"
    assert agent_activity._detail("book_meeting", {"handoff_reason": "x", "needs_human": True}) == (
        "un conseiller doit reprendre"
    )


async def test_a_storage_failure_never_stops_the_agent():
    class BrokenCollection:
        async def update_one(self, *args, **kwargs):
            raise RuntimeError("mongo indisponible")

    recorder = agent_activity.ActivityRecorder(
        {agent_activity.AGENT_ACTIVITY: BrokenCollection()},
        "c1",
        1,
        mode=AgentMode.AUTO,
        trigger="inbound_message",
    )
    await recorder.begin()
    await recorder.step_started("load_prospect")
    await recorder.step_finished("load_prospect", {})
    await recorder.end("continue_conversation")
