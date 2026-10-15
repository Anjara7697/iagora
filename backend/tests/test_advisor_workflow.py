from datetime import UTC, datetime, timedelta

from app.models import CampaignProspect
from app.models.enums import UserRole
from sqlalchemy import select

from .test_campaigns_api import _create, _ingest

API = "/api/v1"


async def test_new_memberships_and_updates_use_the_same_clock(client, monkeypatch):
    from app.services import prospects

    stamp = datetime(2030, 1, 1, 12, 0, 0, 123456, tzinfo=UTC)
    monkeypatch.setattr(prospects, "_now", lambda: stamp)
    campaign = (await _create(client)).json()
    p = (await _ingest(client, campaign, 0, "clock@example.com")).json()["prospect"]
    first = p["campaigns"][0]
    assert datetime.fromisoformat(first["last_seen_at"]).replace(tzinfo=UTC) == stamp
    p = (
        await client.post(
            f"{API}/prospects/{p['id']}/campaigns",
            json={
                "campaign_id": campaign["id"],
                "source_id": campaign["sources"][1]["id"],
            },
        )
    ).json()
    assert p["current_membership_id"] != first["id"]
    assert all(
        datetime.fromisoformat(m["last_seen_at"]).replace(tzinfo=UTC) == stamp
        for m in p["campaigns"]
    )
    stamp += timedelta(microseconds=1)
    p = (await _ingest(client, campaign, 0, "clock@example.com")).json()["prospect"]
    assert p["current_membership_id"] == first["id"]


async def test_advisor_directory_is_minimal_active_paginated_and_authenticated(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    viewer = await make_client(UserRole.VIEWER)
    advisor_id = (await advisor.get(f"{API}/auth/me")).json()["id"]
    first = (await viewer.get(f"{API}/advisors?limit=1")).json()
    second = (await viewer.get(f"{API}/advisors?limit=1&offset=1")).json()
    assert first["total"] == second["total"] == 2
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert set(first["items"][0]) == {"id", "username"}
    await client.patch(f"{API}/users/{advisor_id}", json={"is_active": False})
    assert (await viewer.get(f"{API}/advisors")).json()["total"] == 1
    assert (await viewer.get(f"{API}/users")).status_code == 403
    anon = await make_client(None)
    assert (await anon.get(f"{API}/advisors")).status_code == 401


async def test_receive_assign_treat_and_change_stage_with_consistent_cards(client, make_client):
    advisor = await make_client(UserRole.ADVISOR)
    aid = (await advisor.get(f"{API}/auth/me")).json()["id"]
    campaign = (await _create(client)).json()
    p = (
        await client.post(
            f"{API}/prospects",
            json={
                "email": "journey@example.com",
                "channel": "email",
                "message": "Bonjour",
            },
        )
    ).json()["prospect"]
    pid = p["id"]
    p = (
        await advisor.post(
            f"{API}/prospects/{pid}/campaigns",
            json={
                "campaign_id": campaign["id"],
                "source_id": campaign["sources"][0]["id"],
            },
        )
    ).json()
    mid = p["current_membership_id"]
    assigned = await client.patch(
        f"{API}/campaign-prospects/{mid}", json={"assigned_advisor_id": aid}
    )
    assert assigned.status_code == 200
    cid = (await client.get(f"{API}/prospects/{pid}/conversation")).json()["id"]
    reply = await advisor.post(
        f"{API}/conversations/{cid}/messages",
        json={
            "role": "advisor",
            "content": "Bonjour, je prends en charge votre demande.",
        },
    )
    assert reply.status_code == 201
    assert (
        await advisor.patch(
            f"{API}/campaign-prospects/{mid}",
            json={
                "conversion_stage": "contacted",
                "reason": "Réponse du conseiller enregistrée",
            },
        )
    ).status_code == 200
    card = (await advisor.get(f"{API}/conversations/{cid}/summary")).json()
    assert card["prospect"]["assigned_advisor_id"] == aid
    assert card["prospect"]["stage"] == "contacted"
    assert card["prospect"]["campaign_id"] == campaign["id"]
    assert card["last_message_role"] == "advisor"
    assert "messages" not in card
    assert (await advisor.get(f"{API}/conversations?advisor_id={aid}")).json()["total"] == 1
    history = (await advisor.get(f"{API}/campaign-prospects/{mid}/history")).json()
    assert history["stage_events"][-1]["actor_user_id"] == aid
    interactions = (await advisor.get(f"{API}/prospects/{pid}/interactions?limit=1")).json()
    assert interactions["total"] >= 2 and len(interactions["items"]) == 1
    assert interactions["items"][0]["conversation_ref"] == cid
    stats = (await advisor.get(f"{API}/campaigns/{campaign['id']}/stats")).json()
    assert stats["by_stage"] == {"contacted": 1}


async def test_direct_links_ignore_list_filters_and_todo_scan_window(client, mongo_db, monkeypatch):
    p = (await client.post(f"{API}/prospects", json={"email": "link@example.com"})).json()[
        "prospect"
    ]
    c = (
        await client.post(f"{API}/conversations", json={"prospect_id": p["id"], "channel": "email"})
    ).json()["conversation"]
    cid = c["id"]
    await client.patch(f"{API}/conversations/{cid}", json={"status": "handed_off"})
    assert (await client.get(f"{API}/conversations?status=closed")).json()["items"] == []
    assert (await client.get(f"{API}/conversations/{cid}/summary")).json()["status"] == "handed_off"
    from app.services import todo

    monkeypatch.setattr(todo, "MAX_SCANNED", 1)
    other = (await client.post(f"{API}/prospects", json={"email": "newer@example.com"})).json()[
        "prospect"
    ]
    newer = (
        await client.post(
            f"{API}/conversations", json={"prospect_id": other["id"], "channel": "email"}
        )
    ).json()["conversation"]
    await client.patch(f"{API}/conversations/{newer['id']}", json={"status": "handed_off"})
    # Tri déterministe : la conversation ciblée est hors de la fenêtre de liste.
    from bson import ObjectId

    await mongo_db["conversations"].update_one(
        {"_id": ObjectId(cid)}, {"$set": {"last_message_at": datetime.now(UTC) - timedelta(days=1)}}
    )
    await mongo_db["conversations"].update_one(
        {"_id": ObjectId(newer["id"])}, {"$set": {"last_message_at": datetime.now(UTC)}}
    )
    assert (await client.get(f"{API}/todo")).json()["items"][0]["conversation_id"] == newer["id"]
    item = await client.get(f"{API}/todo/item", params={"id": f"handoff:{cid}"})
    assert item.status_code == 200 and item.json()["conversation_id"] == cid
    await client.patch(f"{API}/conversations/{cid}", json={"status": "closed"})
    assert (
        await client.get(f"{API}/todo/item", params={"id": f"handoff:{cid}"})
    ).status_code == 404
    assert (await client.get(f"{API}/todo/item?id=invalid")).status_code == 404
    assert (await client.get(f"{API}/conversations/not-an-id/summary")).status_code == 404


async def test_multisource_campaign_counts_one_prospect_and_keeps_source_counts(
    client, session_factory, make_client
):
    campaign = (await _create(client)).json()
    p = (await _ingest(client, campaign, 0, "multi@example.com")).json()["prospect"]
    pid = p["id"]
    first = p["campaigns"][0]["id"]
    await _ingest(client, campaign, 1, "multi@example.com")
    # Même horodatage : le plus grand identifiant départage.
    async with session_factory() as s:
        members = list(
            await s.scalars(
                select(CampaignProspect)
                .where(CampaignProspect.prospect_id == pid)
                .order_by(CampaignProspect.id)
            )
        )
        stamp = datetime.now(UTC)
        for member in members:
            member.last_seen_at = stamp
        await s.commit()
        last = members[-1].id
    await client.patch(
        f"{API}/campaign-prospects/{first}",
        json={"conversion_stage": "lost", "reason": "Ancienne source"},
    )
    await client.patch(
        f"{API}/campaign-prospects/{last}",
        json={"conversion_stage": "converted", "reason": "Inscription confirmée"},
    )
    stats = (await client.get(f"{API}/campaigns/{campaign['id']}/stats")).json()
    assert stats["prospects"] == 1 and stats["converted"] == 1
    assert stats["by_stage"] == {"converted": 1}
    assert [row["prospects"] for row in stats["by_source"]] == [1, 1]
    overview = (await client.get(f"{API}/campaigns/overview")).json()[0]
    assert overview["prospects"] == 1 and overview["converted"] == 1
    dashboard = (await client.get(f"{API}/dashboard/summary")).json()
    assert dashboard["leads"] == 1 and dashboard["funnel"] == {"converted": 1}

    advisor = await make_client(UserRole.ADVISOR)
    aid = (await advisor.get(f"{API}/auth/me")).json()["id"]
    await client.patch(f"{API}/campaign-prospects/{first}", json={"assigned_advisor_id": aid})
    assert (await advisor.get(f"{API}/prospects?advisor_id={aid}")).json()["total"] == 0
    await client.patch(f"{API}/campaign-prospects/{last}", json={"assigned_advisor_id": aid})
    assert (await advisor.get(f"{API}/prospects?advisor_id={aid}")).json()["total"] == 1
    other = (
        await _create(
            client,
            name="Deuxième campagne",
            sources=[{"name": "Autre", "type": "ads", "platform": "web"}],
        )
    ).json()
    await _ingest(client, other, 0, "multi@example.com")
    assert (await advisor.get(f"{API}/prospects?advisor_id={aid}")).json()["total"] == 0
    assert (
        await advisor.get(f"{API}/prospects?advisor_id={aid}&campaign_id={campaign['id']}")
    ).json()["total"] == 1
    assert (await advisor.get(f"{API}/dashboard/summary")).json()["leads"] == 1
