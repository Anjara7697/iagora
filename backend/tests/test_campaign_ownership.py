import asyncio
import os

import pytest
from app.models.enums import UserRole

from .test_campaigns_api import _create, _ingest

API = "/api/v1"


async def owner(client, campaign, aid, policy="transfer_inherited"):
    return await client.put(
        f"{API}/campaigns/{campaign['id']}/responsible",
        json={
            "advisor_id": aid,
            "existing_prospects": policy,
        },
    )


async def who(client):
    return (await client.get(f"{API}/auth/me")).json()["id"]


async def test_default_owner_and_exception_follow_prospect_across_sources(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    aid, admin = await who(advisor), await who(client)
    campaign = (await _create(client)).json()
    result = await owner(client, campaign, aid)
    assert result.status_code == 200
    assert result.json()["responsible_advisor_name"] == "advisor-user"
    assert (await advisor.get(f"{API}/campaigns?advisor_id={aid}")).json()["total"] == 1
    assert (await advisor.get(f"{API}/campaigns?advisor_id={admin}")).json()["total"] == 0
    p = (await _ingest(client, campaign, 0, "inherited@example.com")).json()["prospect"]
    first = p["campaigns"][0]
    assert first["assigned_advisor_id"] == aid and not first["assignment_is_override"]
    await client.patch(
        f"{API}/campaign-prospects/{first['id']}", json={"assigned_advisor_id": admin}
    )
    p = (await _ingest(client, campaign, 1, "inherited@example.com")).json()["prospect"]
    assert all(
        m["assigned_advisor_id"] == admin and m["assignment_is_override"] for m in p["campaigns"]
    )
    reset = await client.patch(
        f"{API}/campaign-prospects/{first['id']}", json={"inherit_campaign_advisor": True}
    )
    assert reset.status_code == 200 and not reset.json()["assignment_is_override"]
    p = (await client.get(f"{API}/prospects/{p['id']}")).json()
    assert all(
        m["assigned_advisor_id"] == aid and not m["assignment_is_override"] for m in p["campaigns"]
    )


async def test_campaign_transfer_preserves_exceptions_and_business_history(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    aid, admin = await who(advisor), await who(client)
    campaign = (await _create(client)).json()
    p = (await _ingest(client, campaign, 0, "old@example.com")).json()["prospect"]
    mid = p["campaigns"][0]["id"]
    exception = (await _ingest(client, campaign, 0, "exception@example.com")).json()["prospect"][
        "campaigns"
    ][0]["id"]
    await client.patch(f"{API}/campaign-prospects/{exception}", json={"assigned_advisor_id": admin})
    await client.patch(
        f"{API}/campaign-prospects/{mid}",
        json={"conversion_stage": "qualified", "reason": "Qualification vérifiée"},
    )
    await client.post(f"{API}/campaign-prospects/{mid}/scores", json={"signal": "message_received"})
    history = (await client.get(f"{API}/campaign-prospects/{mid}/history")).json()
    before = (await client.get(f"{API}/campaign-prospects/{mid}")).json()
    await owner(client, campaign, aid)
    after = (await client.get(f"{API}/campaign-prospects/{mid}")).json()
    assert after["assigned_advisor_id"] == aid and not after["assignment_is_override"]
    for field in ("conversion_stage", "total_score", "last_seen_at"):
        assert after[field] == before[field]
    assert (await client.get(f"{API}/campaign-prospects/{mid}/history")).json() == history
    assert (await client.get(f"{API}/campaign-prospects/{exception}")).json()[
        "assigned_advisor_id"
    ] == admin
    await owner(client, campaign, None)
    assert (await client.get(f"{API}/campaign-prospects/{mid}")).json()[
        "assigned_advisor_id"
    ] is None
    assert (await client.get(f"{API}/campaign-prospects/{exception}")).json()[
        "assigned_advisor_id"
    ] == admin


async def test_future_only_keeps_existing_even_unassigned_and_supports_reset(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    aid = await who(advisor)
    campaign = (await _create(client)).json()
    old = (await _ingest(client, campaign, 0, "preserved@example.com")).json()["prospect"]
    await owner(client, campaign, aid, "keep")
    old = (await _ingest(client, campaign, 1, "preserved@example.com")).json()["prospect"]
    assert all(
        m["assigned_advisor_id"] is None and m["assignment_is_override"] for m in old["campaigns"]
    )
    new = (await _ingest(client, campaign, 0, "new@example.com")).json()["prospect"]
    assert new["campaigns"][0]["assigned_advisor_id"] == aid
    await client.patch(
        f"{API}/campaign-prospects/{old['campaigns'][0]['id']}",
        json={"inherit_campaign_advisor": True},
    )
    assert (await advisor.get(f"{API}/prospects?advisor_id={aid}")).json()["total"] == 2


async def test_manual_attribution_inherits_and_other_campaign_stays_independent(
    client, make_client
):
    advisor = await make_client(UserRole.ADVISOR)
    aid = await who(advisor)
    first = (await _create(client)).json()
    second = (
        await _create(
            client,
            name="Autre",
            sources=[{"name": "Autre source", "type": "form", "platform": "web"}],
        )
    ).json()
    await owner(client, first, aid)
    p = (await client.post(f"{API}/prospects", json={"email": "unassigned@example.com"})).json()[
        "prospect"
    ]
    p = (
        await advisor.post(
            f"{API}/prospects/{p['id']}/campaigns",
            json={"campaign_id": first["id"], "source_id": first["sources"][0]["id"]},
        )
    ).json()
    assert p["campaigns"][0]["assigned_advisor_id"] == aid
    p = (await _ingest(client, second, 0, "unassigned@example.com")).json()["prospect"]
    assert p["campaigns"][-1]["assigned_advisor_id"] is None
    assert (await client.get(f"{API}/conversations?advisor_id={aid}")).json()["total"] == 0
    assert (
        await advisor.get(f"{API}/prospects?advisor_id={aid}&campaign_id={first['id']}")
    ).json()["total"] == 1


async def test_permissions_explicit_policy_and_inactive_advisor(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    viewer = await make_client(UserRole.VIEWER)
    anon = await make_client(None)
    campaign = (await _create(client)).json()
    aid, vid = await who(advisor), await who(viewer)
    assert (await owner(advisor, campaign, aid)).status_code == 403
    assert (await owner(viewer, campaign, aid)).status_code == 403
    assert (await owner(anon, campaign, aid)).status_code == 401
    assert (await owner(client, campaign, vid)).status_code == 422
    assert (await owner(client, campaign, 999)).status_code == 422
    assert (
        await client.put(f"{API}/campaigns/{campaign['id']}/responsible", json={"advisor_id": aid})
    ).status_code == 422
    await owner(client, campaign, aid)
    await client.patch(f"{API}/users/{aid}", json={"is_active": False})
    assert (await client.get(f"{API}/campaigns/{campaign['id']}")).json()[
        "responsible_advisor_active"
    ] is False
    assert (await owner(client, campaign, aid)).status_code == 422
    p = (await _ingest(client, campaign, 0, "inactive-owner@example.com")).json()["prospect"]
    assert p["campaigns"][0]["assigned_advisor_id"] is None
    mid = p["campaigns"][0]["id"]
    assert (
        await viewer.patch(
            f"{API}/campaign-prospects/{mid}", json={"inherit_campaign_advisor": True}
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"{API}/campaign-prospects/{mid}",
            json={"inherit_campaign_advisor": True, "assigned_advisor_id": None},
        )
    ).status_code == 422


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql"),
    reason="Verrous PostgreSQL réels",
)
async def test_arrivals_during_campaign_transfer_keep_the_final_owner(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    aid = await who(advisor)
    campaign = (await _create(client)).json()
    await owner(client, campaign, await who(client))
    results = await asyncio.gather(
        owner(client, campaign, aid),
        *[_ingest(client, campaign, 0, f"concurrent-{n}@example.com") for n in range(3)],
    )
    assert all(r.status_code in (200, 201) for r in results)
    listing = (await client.get(f"{API}/prospects?campaign_id={campaign['id']}")).json()
    assert listing["total"] == 3
    assert all(p["campaigns"][0]["assigned_advisor_id"] == aid for p in listing["items"])
