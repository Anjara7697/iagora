async def _create(client, **over):
    payload = {
        "name": "Recrutement eBIHAR 2026",
        "status": "active",
        "target_codes": ["ebihar_students"],
        "sources": [
            {"name": "LinkedIn", "type": "ads", "platform": "linkedin", "external_id": "li-1"},
            {"name": "Landing", "type": "landing_page", "platform": "web"},
        ],
    } | over
    return await client.post("/api/v1/campaigns", json=payload)


async def test_create_campaign_with_targets_and_sources(client):
    r = await _create(client)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "active"
    assert [t["code"] for t in body["targets"]] == ["ebihar_students"]
    assert len(body["sources"]) == 2  # F-02 : plusieurs sources par campagne


async def test_unknown_target_rejected(client):
    r = await _create(client, target_codes=["nope"])
    assert r.status_code == 422


async def test_invalid_dates_rejected(client):
    r = await _create(client, start_date="2026-05-01T00:00:00Z", end_date="2026-04-01T00:00:00Z")
    assert r.status_code == 422


async def test_get_list_and_deactivate(client):
    cid = (await _create(client)).json()["id"]
    assert (await client.get(f"/api/v1/campaigns/{cid}")).json()["name"].startswith("Recrutement")
    r = await client.patch(f"/api/v1/campaigns/{cid}", json={"status": "inactive"})  # F-01
    assert r.json()["status"] == "inactive"
    listing = (await client.get("/api/v1/campaigns", params={"status": "inactive"})).json()
    assert listing["total"] == 1
    assert (await client.get("/api/v1/campaigns", params={"status": "active"})).json()["total"] == 0


async def test_campaign_not_found(client):
    assert (await client.get("/api/v1/campaigns/999")).status_code == 404


async def _ingest(client, camp, source_index, email, **over):
    return await client.post(
        "/api/v1/prospects",
        json={
            "email": email,
            "channel": "email",
            "campaign_id": camp["id"],
            "source_id": camp["sources"][source_index]["id"],
        }
        | over,
    )


async def test_targets_are_listed_for_the_campaign_form(client):
    targets = (await client.get("/api/v1/targets")).json()
    assert {"ebihar_students", "compagnons_pros"} <= {t["code"] for t in targets}


async def test_targets_of_a_campaign_can_be_replaced(client):
    camp = (await _create(client)).json()
    r = await client.patch(
        f"/api/v1/campaigns/{camp['id']}",
        json={"target_codes": ["compagnons_pros", "master_candidates", "compagnons_pros"]},
    )
    assert r.status_code == 200
    assert [t["code"] for t in r.json()["targets"]] == ["compagnons_pros", "master_candidates"]
    unknown = await client.patch(f"/api/v1/campaigns/{camp['id']}", json={"target_codes": ["nope"]})
    assert unknown.status_code == 422
    kept = await client.patch(f"/api/v1/campaigns/{camp['id']}", json={"name": "Renommée"})
    assert len(kept.json()["targets"]) == 2  # sans target_codes, les cibles ne changent pas


async def test_add_and_remove_a_source(client):
    camp = (await _create(client)).json()
    added = await client.post(
        f"/api/v1/campaigns/{camp['id']}/sources",
        json={"name": "Webinaire", "type": "webinar", "platform": "web", "external_id": "w-1"},
    )
    assert added.status_code == 201 and len(added.json()["sources"]) == 3
    new_id = added.json()["sources"][-1]["id"]
    again = await client.post(
        f"/api/v1/campaigns/{camp['id']}/sources",
        json={"name": "Webinaire", "type": "webinar", "platform": "web", "external_id": "w-1"},
    )
    assert again.status_code == 409
    removed = await client.delete(f"/api/v1/campaigns/{camp['id']}/sources/{new_id}")
    assert removed.status_code == 200 and len(removed.json()["sources"]) == 2
    assert (
        await client.delete(f"/api/v1/campaigns/{camp['id']}/sources/{new_id}")
    ).status_code == 404


async def test_a_source_with_prospects_cannot_be_removed(client):
    camp = (await _create(client)).json()
    await _ingest(client, camp, 0, "a@example.com")
    r = await client.delete(f"/api/v1/campaigns/{camp['id']}/sources/{camp['sources'][0]['id']}")
    assert r.status_code == 409 and "1 prospect" in r.json()["detail"]
    free = await client.delete(f"/api/v1/campaigns/{camp['id']}/sources/{camp['sources'][1]['id']}")
    assert free.status_code == 200


async def test_stats_give_the_funnel_levels_and_sources(client):
    camp = (await _create(client)).json()
    await _ingest(client, camp, 0, "a@example.com")
    await _ingest(client, camp, 0, "b@example.com")
    c = (await _ingest(client, camp, 1, "c@example.com")).json()["prospect"]
    membership = c["campaigns"][0]["id"]
    await client.post(
        f"/api/v1/campaign-prospects/{membership}/scores",
        json={"signal": "meeting_requested"},
    )
    moved = await client.patch(
        f"/api/v1/campaign-prospects/{membership}",
        json={"conversion_stage": "meeting_scheduled", "reason": "Rendez-vous pris"},
    )
    assert moved.status_code == 200

    stats = (await client.get(f"/api/v1/campaigns/{camp['id']}/stats")).json()
    assert stats["prospects"] == 3
    assert stats["by_stage"] == {"new": 2, "meeting_scheduled": 1}
    assert stats["meetings"] == 1 and stats["converted"] == 0
    assert stats["average_score"] > 0
    assert [(s["name"], s["prospects"]) for s in stats["by_source"]] == [
        ("LinkedIn", 2),
        ("Landing", 1),
    ]
    assert sum(stats["by_level"].values()) == 3
    assert (await client.get("/api/v1/campaigns/999/stats")).status_code == 404


async def test_overview_lists_every_campaign_even_without_prospects(client):
    full = (await _create(client)).json()
    empty = (await _create(client, name="Vide", sources=[])).json()
    await _ingest(client, full, 0, "a@example.com")
    overview = {
        o["campaign_id"]: o for o in (await client.get("/api/v1/campaigns/overview")).json()
    }
    assert overview[full["id"]]["prospects"] == 1
    assert overview[empty["id"]] == {
        "campaign_id": empty["id"],
        "prospects": 0,
        "hot": 0,
        "meetings": 0,
        "qualified": 0,
        "converted": 0,
    }


async def test_only_administrators_change_campaigns(make_client):
    from app.models.enums import UserRole

    admin = await make_client(UserRole.ADMIN)
    camp = (await _create(admin)).json()
    for role in (UserRole.ADVISOR, UserRole.VIEWER):
        other = await make_client(role)
        assert (await other.get(f"/api/v1/campaigns/{camp['id']}/stats")).status_code == 200
        assert (await other.get("/api/v1/targets")).status_code == 200
        assert (
            await other.post(
                f"/api/v1/campaigns/{camp['id']}/sources",
                json={"name": "X", "type": "form", "platform": "web"},
            )
        ).status_code == 403
        assert (
            await other.patch(f"/api/v1/campaigns/{camp['id']}", json={"target_codes": []})
        ).status_code == 403
