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
