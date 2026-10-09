import pytest

API = "/api/v1"


@pytest.fixture
async def campaign(client):
    r = await client.post(
        f"{API}/campaigns",
        json={
            "name": "eBIHAR 2026",
            "status": "active",
            "sources": [{"name": "LinkedIn", "type": "ads", "platform": "linkedin"}],
        },
    )
    body = r.json()
    return {"campaign_id": body["id"], "source_id": body["sources"][0]["id"]}


async def _ingest(client, **over):
    payload = {"first_name": "Jean", "email": "Jean@Example.com", "channel": "email"} | over
    return await client.post(f"{API}/prospects", json=payload)


async def test_ingest_creates_prospect_and_interaction(client, campaign):
    r = await _ingest(client, message="Bonjour", **campaign)
    assert r.status_code == 201
    body = r.json()
    assert body["created"] is True
    assert body["prospect"]["email"] == "jean@example.com"  # normalisé
    assert body["prospect"]["origin_channel_id"] is not None
    assert body["prospect"]["consent_status"] == "unknown"
    membership = body["prospect"]["campaigns"][0]  # F-03
    assert membership["conversion_stage"] == "new"
    pid = body["prospect"]["id"]
    history = (await client.get(f"{API}/prospects/{pid}/interactions")).json()
    assert history["total"] == 1  # F-06
    assert history["items"][0]["content"] == "Bonjour"


async def test_duplicate_is_recognised_by_any_identifier(client):
    first = (await _ingest(client, phone="06 12 34 56 78")).json()
    again = await _ingest(client, email="other@example.com", phone="06.12.34.56.78")
    assert again.status_code == 200
    assert again.json()["created"] is False
    assert again.json()["prospect"]["id"] == first["prospect"]["id"]  # F-05
    listing = (await client.get(f"{API}/prospects")).json()
    assert listing["total"] == 1


async def test_duplicate_enriches_empty_fields_only(client):
    await _ingest(client, first_name="Jean")
    r = await _ingest(client, first_name="Autre", last_name="Dupont", phone="0611223344")
    p = r.json()["prospect"]
    assert p["first_name"] == "Jean"  # jamais écrasé
    assert p["last_name"] == "Dupont"
    assert p["phone"] == "0611223344"


async def test_same_prospect_in_two_campaigns(client, campaign):
    other = (
        await client.post(
            f"{API}/campaigns",
            json={"name": "Autre", "sources": [{"name": "FB", "type": "ads", "platform": "meta"}]},
        )
    ).json()
    await _ingest(client, **campaign)
    r = await _ingest(client, campaign_id=other["id"], source_id=other["sources"][0]["id"])
    assert len(r.json()["prospect"]["campaigns"]) == 2  # F-03


async def test_ingest_validation(client, campaign):
    assert (await client.post(f"{API}/prospects", json={"first_name": "x"})).status_code == 422
    assert (await _ingest(client, channel="telegram")).status_code == 422
    assert (await _ingest(client, campaign_id=campaign["campaign_id"])).status_code == 422
    assert (await _ingest(client, email="pas-un-email")).status_code == 422


async def test_replayed_webhook_creates_no_second_interaction(client):
    first = (await _ingest(client, external_id="m-1")).json()
    second = (await _ingest(client, external_id="m-1")).json()
    assert first["interaction_id"] == second["interaction_id"]  # NF-05
    pid = first["prospect"]["id"]
    assert (await client.get(f"{API}/prospects/{pid}/interactions")).json()["total"] == 1


async def test_search_and_filters(client, campaign):
    await _ingest(client, first_name="Alice", email="alice@example.com", **campaign)
    await _ingest(client, first_name="Bob", email="bob@example.com")
    assert (await client.get(f"{API}/prospects", params={"q": "ali"})).json()["total"] == 1
    r = await client.get(f"{API}/prospects", params={"campaign_id": campaign["campaign_id"]})
    assert r.json()["total"] == 1
    assert (await client.get(f"{API}/prospects", params={"stage": "lost"})).json()["total"] == 0
    page = (await client.get(f"{API}/prospects", params={"limit": 1, "offset": 1})).json()
    assert len(page["items"]) == 1 and page["total"] == 2


async def test_get_update_and_conflict(client):
    a = (await _ingest(client, email="a@example.com")).json()["prospect"]["id"]
    b = (await _ingest(client, email="b@example.com")).json()["prospect"]["id"]
    r = await client.patch(f"{API}/prospects/{a}", json={"last_name": "Martin"})
    assert r.json()["last_name"] == "Martin"
    r = await client.patch(f"{API}/prospects/{b}", json={"email": "A@example.com"})
    assert r.status_code == 409
    assert (await client.get(f"{API}/prospects/999")).status_code == 404


async def test_consent_on_ingest_and_optout_blocks_outbound(client):
    r = await _ingest(client, consent_granted=True, consent_source="web_form")
    p = r.json()["prospect"]
    assert p["consent_status"] == "granted" and p["consent_source"] == "web_form"
    pid = p["id"]

    out = await client.post(f"{API}/prospects/{pid}/opt-out", json={"source": "email_reply"})
    assert out.json()["consent_status"] == "opted_out"
    assert out.json()["opted_out_at"] is not None

    outbound = {"type": "email", "direction": "outbound", "content": "Relance", "channel": "email"}
    blocked = await client.post(f"{API}/prospects/{pid}/interactions", json=outbound)
    assert blocked.status_code == 409  # S-03 / scénario 4
    inbound = {**outbound, "direction": "inbound"}
    assert (
        await client.post(f"{API}/prospects/{pid}/interactions", json=inbound)
    ).status_code == 201


async def test_optout_survives_reingestion_until_explicit_consent(client):
    pid = (await _ingest(client)).json()["prospect"]["id"]
    await client.post(f"{API}/prospects/{pid}/opt-out", json={})
    again = await _ingest(client, consent_granted=True)
    assert again.json()["prospect"]["consent_status"] == "opted_out"
    granted = await client.post(f"{API}/prospects/{pid}/consent", json={"source": "web_form"})
    assert granted.json()["consent_status"] == "granted"
    assert granted.json()["opted_out_at"] is None


async def test_optout_is_idempotent_and_cancels_follow_ups(client, session_factory):
    from datetime import UTC, datetime

    from app.models import ConsentEvent, FollowUp
    from app.models.enums import FollowUpStatus
    from sqlalchemy import select

    pid = (await _ingest(client)).json()["prospect"]["id"]
    async with session_factory() as s:
        s.add(FollowUp(prospect_id=pid, scheduled_at=datetime.now(UTC)))
        await s.commit()
    await client.post(f"{API}/prospects/{pid}/opt-out", json={})
    await client.post(f"{API}/prospects/{pid}/opt-out", json={})
    async with session_factory() as s:
        assert len((await s.scalars(select(ConsentEvent))).all()) == 1  # un seul événement
        statuses = (await s.scalars(select(FollowUp.status))).all()
    assert statuses == [FollowUpStatus.CANCELLED]


async def test_interactions_idempotent_and_listed_newest_first(client):
    pid = (await _ingest(client)).json()["prospect"]["id"]
    body = {"type": "message", "direction": "inbound", "channel": "email", "external_id": "x1"}
    first = await client.post(f"{API}/prospects/{pid}/interactions", json=body)
    replay = await client.post(f"{API}/prospects/{pid}/interactions", json=body)
    assert first.status_code == 201 and replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    await client.post(f"{API}/prospects/{pid}/interactions", json={**body, "external_id": "x2"})
    items = (await client.get(f"{API}/prospects/{pid}/interactions")).json()["items"]
    assert [i["external_id"] for i in items][:2] == ["x2", "x1"]
    assert (await client.get(f"{API}/prospects/999/interactions")).status_code == 404


async def test_list_carries_each_prospect_memberships(client):
    camp = (
        await client.post(
            f"{API}/campaigns",
            json={
                "name": "Liste",
                "status": "active",
                "sources": [{"name": "LinkedIn", "type": "ads", "platform": "linkedin"}],
            },
        )
    ).json()
    await client.post(
        f"{API}/prospects",
        json={
            "email": "a@example.com",
            "campaign_id": camp["id"],
            "source_id": camp["sources"][0]["id"],
        },
    )
    await client.post(f"{API}/prospects", json={"email": "b@example.com"})
    items = (await client.get(f"{API}/prospects")).json()["items"]
    by_email = {i["email"]: i for i in items}
    assert by_email["a@example.com"]["campaigns"][0]["conversion_stage"] == "new"
    assert by_email["b@example.com"]["campaigns"] == []
