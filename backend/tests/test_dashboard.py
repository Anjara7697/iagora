"""Synthèse de l'écran « Aujourd'hui » : signaux forts, activité, relances, entonnoir."""

from datetime import UTC, datetime, timedelta

from app.models import FollowUp
from app.models.enums import ConversionStage, UserRole
from app.services import agent_settings, pipeline
from app.services.agent_settings import AgentMode
from sqlalchemy import select

from .test_agent_workflow import env as env  # noqa: F401  (fixture)
from .test_agent_workflow import lead, run

API = "/api/v1"


async def summary(client):
    r = await client.get(f"{API}/dashboard/summary")
    assert r.status_code == 200, r.text
    return r.json()


async def test_empty_instance_returns_zeroes(client):
    body = await summary(client)
    assert body["hot_prospects"] == [] and body["follow_ups"] == [] and body["leads"] == 0
    assert body["activity"]["prospects_analysed"] == 0 and body["activity"]["errors"] == 0
    assert body["agent_mode"] == "assisted"


async def test_summary_counts_real_prospects_activity_and_funnel(
    client,
    env,
    session_factory,
    mongo_db,  # noqa: F811
):
    await agent_settings.set_mode(mongo_db, AgentMode.ASSISTED, None)
    pid, mid, cid = await lead(client, "Bonjour, je voudrais des informations.")
    await run(client, cid)
    async with session_factory() as s:
        s.add(
            FollowUp(
                prospect_id=pid,
                campaign_prospect_id=mid,
                scheduled_at=datetime.now(UTC) + timedelta(days=2),
                reason="Relance J+3",
            )
        )
        await s.commit()
    body = await summary(client)
    assert body["leads"] == 1 and sum(body["funnel"].values()) == 1
    assert body["activity"]["prospects_analysed"] == 1
    assert body["activity"]["drafts_generated"] == 1  # mode assisté : un brouillon
    assert body["activity"]["sent_without_validation"] == 0
    assert body["follow_ups_total"] >= 1
    assert body["follow_ups"][0]["prospect_name"] == "Jean"
    assert all(p["id"] == pid for p in body["hot_prospects"])


async def test_fictitious_prospects_are_left_out(client, env, session_factory):  # noqa: F811
    pid, mid, cid = await lead(client, "Bonjour", email="sim.camille@demo.example.com")
    await run(client, cid)
    async with session_factory() as s:
        s.add(
            FollowUp(
                prospect_id=pid,
                campaign_prospect_id=mid,
                scheduled_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await s.commit()
    body = await summary(client)
    assert body["leads"] == 0 and body["follow_ups_total"] == 0 and body["hot_prospects"] == []
    assert body["activity"]["prospects_analysed"] == 0 and body["activity"]["drafts_generated"] == 0
    async with session_factory() as s:
        assert (await s.scalars(select(FollowUp))).all()  # elles existent bien en base


async def test_viewer_can_read_the_summary(make_client):
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.get(f"{API}/dashboard/summary")).status_code == 200
    anonymous = await make_client(None)
    assert (await anonymous.get(f"{API}/dashboard/summary")).status_code == 401


# --- Tableau de bord (Pilotage) ---


async def overview(client, days=30):
    r = await client.get(f"{API}/dashboard/overview", params={"days": days})
    assert r.status_code == 200, r.text
    return r.json()


async def test_overview_counts_reached_stages_and_breakdowns(client, env, session_factory):  # noqa: F811
    pid, mid, _ = await lead(client, "Bonjour")
    membership = (await client.get(f"{API}/prospects/{pid}")).json()["campaigns"][0]
    second = await client.post(
        f"{API}/prospects",
        json={
            "first_name": "Lina",
            "email": "lina@example.com",
            "channel": "email",
            "campaign_id": membership["campaign_id"],
            "source_id": membership["source_id"],
        },
    )
    assert second.status_code in (200, 201), second.text
    # Fictif (autre téléphone, sinon il serait rapproché de Jean) : exclu des chiffres.
    await lead(client, "Bonjour", email="sim.zoe@demo.example.com", phone="0699999999")
    async with session_factory() as s:
        # Rendez-vous planifié puis perdu : compte quand même dans « Rendez-vous » (étape atteinte).
        await pipeline.change_stage(s, mid, ConversionStage.QUALIFIED, "profil complet")
        await pipeline.change_stage(s, mid, ConversionStage.MEETING_SCHEDULED, "créneau réservé")
        await pipeline.change_stage(s, mid, ConversionStage.LOST, "a choisi une autre école")
    body = await overview(client)
    steps = {step["key"]: step["count"] for step in body["funnel"]}
    assert body["leads"] == 2, body
    assert steps == {
        "leads": 2,
        "qualified": 1,
        "meeting": 1,
        "applied": 0,
        "converted": 0,
    }
    assert sum(b["count"] for b in body["by_target"]) == body["leads"]
    assert sum(b["count"] for b in body["by_source"]) == body["leads"]
    assert {b["label"] for b in body["by_target"]} == {"Étudiants eBIHAR", "Non renseigné"}
    source = {"key": str(membership["source_id"]), "label": "LinkedIn", "count": 2}
    assert body["by_source"] == [source]


async def test_overview_period_is_limited_to_7_30_or_90_days(client):
    assert (await overview(client, 7))["days"] == 7
    assert (await overview(client, 90))["leads"] == 0
    assert (await client.get(f"{API}/dashboard/overview", params={"days": 10})).status_code == 422


async def test_viewer_can_read_the_overview(make_client):
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.get(f"{API}/dashboard/overview")).status_code == 200


async def test_agent_activity_over_a_week(client, env):  # noqa: F811
    pid, mid, cid = await lead(client, "Bonjour, je voudrais des informations.")
    await run(client, cid)
    r = await client.get(f"{API}/dashboard/activity")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["hours"] == 7 * 24 and body["prospects_analysed"] == 1
    assert (await client.get(f"{API}/dashboard/activity", params={"days": 3})).status_code == 422
