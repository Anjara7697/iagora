"""Synthèse de l'écran « Aujourd'hui » : signaux forts, activité, relances, entonnoir."""

from datetime import UTC, datetime, timedelta

from app.models import FollowUp
from app.models.enums import UserRole
from app.services import agent_settings
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
