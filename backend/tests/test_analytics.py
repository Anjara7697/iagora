"""Analyses : délais, brouillons, motifs de refus, couverture, prospects fictifs exclus."""

from datetime import UTC, datetime, timedelta

from app.models import Prospect
from app.models.enums import UserRole

API = "/api/v1"
NOW = datetime.now(UTC)


def msg(mid, role, minutes, **metadata):
    return {
        "id": mid,
        "role": role,
        "content": f"message {mid}",
        "created_at": NOW - timedelta(days=1) + timedelta(minutes=minutes),
        "metadata": metadata,
    }


async def analytics(client, days=30):
    r = await client.get(f"{API}/analytics", params={"days": days})
    assert r.status_code == 200, r.text
    return r.json()


async def test_empty_instance_measures_nothing(client):
    body = await analytics(client)
    assert body["first_reply_sent"] == {"median_seconds": None, "count": 0}
    assert body["average_confidence"] is None and body["reject_reasons"] == []
    assert body["drafts"]["generated"] == 0 and body["coverage"] == {"questions": 0, "answered": 0}
    assert [s["key"] for s in body["funnel"]][0] == "leads"


async def test_delays_drafts_reasons_and_coverage(client, mongo_db, session_factory):
    async with session_factory() as s:
        demo = Prospect(first_name="Zoé", email="sim.zoe@demo.example.com")
        s.add(demo)
        await s.commit()
        demo_id = demo.id
    sent_at = NOW - timedelta(days=1) + timedelta(minutes=30)
    sent = {"delivery": "sent", "delivery_info": {"at": sent_at}}
    await mongo_db["conversations"].insert_many(
        [
            {  # répondu : brouillon validé tel quel, envoyé 30 min après le message du prospect
                "prospect_id": 101,
                "channel": "email",
                "status": "open",
                "messages": [
                    msg("a1", "prospect", 0),
                    msg(
                        "a2",
                        "agent",
                        1,
                        draft={"status": "approved", "edited": False},
                        confidence=0.9,
                        **sent,
                    ),
                ],
            },
            {  # brouillon refusé deux fois pour le même motif (casse et espaces différents)
                "prospect_id": 102,
                "channel": "email",
                "status": "open",
                "messages": [
                    msg("b1", "prospect", 0),
                    msg(
                        "b2",
                        "agent",
                        3,
                        draft={"status": "rejected", "reason": "Ton trop familier"},
                        confidence=0.5,
                    ),
                    msg(
                        "b3",
                        "agent",
                        6,
                        draft={"status": "rejected", "reason": " ton  trop familier "},
                    ),
                    msg("b4", "agent", 9, draft={"status": "approved", "edited": True}),
                ],
            },
            {  # prospect fictif : exclu de toutes les mesures
                "prospect_id": demo_id,
                "channel": "email",
                "status": "open",
                "messages": [
                    msg("c1", "prospect", 0),
                    msg("c2", "agent", 1, draft={"status": "pending"}),
                ],
            },
        ]
    )
    started = NOW - timedelta(hours=2)
    question = [{"node": "qualify_prospect", "summary": "intention question, sentiment neutral"}]
    await mongo_db["agent_runs"].insert_many(
        [
            {"prospect_id": 101, "status": "completed", "started_at": started, "trace": question},
            {
                "prospect_id": 102,
                "status": "completed",
                "started_at": started,
                "trace": question,
                "handoff_reason": "question_hors_base",
            },
            {"prospect_id": 102, "status": "completed", "started_at": started, "trace": []},
            {
                "prospect_id": demo_id,
                "status": "completed",
                "started_at": started,
                "trace": question,
            },
        ]
    )
    body = await analytics(client)
    assert body["first_reply_drafted"] == {"median_seconds": 120.0, "count": 2}  # 1 et 3 min
    assert body["first_reply_sent"] == {"median_seconds": 1800.0, "count": 1}
    assert body["drafts"] == {
        "generated": 4,
        "approved_unchanged": 1,
        "approved_edited": 1,
        "rejected": 2,
        "superseded": 0,
        "pending": 0,
    }
    assert body["reject_reasons"] == [{"reason": "Ton trop familier", "count": 2}]
    assert body["average_confidence"] == 0.7
    assert body["coverage"] == {"questions": 2, "answered": 1}


async def test_old_activity_is_outside_the_period(client, mongo_db):
    old = NOW - timedelta(days=40)
    await mongo_db["conversations"].insert_one(
        {
            "prospect_id": 7,
            "channel": "email",
            "status": "open",
            "messages": [
                {"id": "o1", "role": "prospect", "content": "x", "created_at": old, "metadata": {}},
                {
                    "id": "o2",
                    "role": "agent",
                    "content": "y",
                    "created_at": old,
                    "metadata": {"draft": {"status": "rejected", "reason": "ancien"}},
                },
            ],
        }
    )
    body = await analytics(client, 30)
    assert body["drafts"]["generated"] == 0 and body["first_reply_drafted"]["count"] == 0
    assert (await analytics(client, 90))["drafts"]["rejected"] == 1


async def test_period_is_validated_and_viewers_can_read(client, make_client):
    assert (await client.get(f"{API}/analytics", params={"days": 12})).status_code == 422
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.get(f"{API}/analytics")).status_code == 200
