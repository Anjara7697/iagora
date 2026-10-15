"""Données fictives : repérage, filtre et purge (outil de recette, jamais en production)."""

from app.config import get_settings
from app.main import app
from app.models.enums import UserRole

API = "/api/v1"


async def make(client, email, name="Test"):
    r = await client.post(f"{API}/prospects", json={"first_name": name, "email": email})
    assert r.status_code == 201, r.text
    return r.json()["prospect"]["id"]


async def conversation_for(client, pid):
    r = await client.post(
        f"{API}/conversations",
        json={
            "prospect_id": pid,
            "channel": "email",
            "message": {"role": "prospect", "content": "Bonjour"},
        },
    )
    assert r.status_code == 201, r.text


async def test_prospects_expose_and_filter_the_demo_flag(client):
    await make(client, "sim.alice@demo.example.com", "Alice")
    await make(client, "bob@acme-corp.com", "Bob")
    everyone = (await client.get(f"{API}/prospects")).json()["items"]
    flags = {p["first_name"]: p["is_demo"] for p in everyone}
    assert flags == {"Alice": True, "Bob": False}
    only = (await client.get(f"{API}/prospects", params={"demo": "only"})).json()
    assert [p["first_name"] for p in only["items"]] == ["Alice"]
    real = (await client.get(f"{API}/prospects", params={"demo": "exclude"})).json()
    assert [p["first_name"] for p in real["items"]] == ["Bob"] and real["total"] == 1
    assert (await client.get(f"{API}/prospects", params={"demo": "x"})).status_code == 422


async def test_purge_removes_only_fictitious_data(client):
    fake = await make(client, "sim.alice@demo.example.com")
    real = await make(client, "bob@acme-corp.com", "Bob")
    await conversation_for(client, fake)
    await conversation_for(client, real)
    summary = (await client.get(f"{API}/demo")).json()
    assert summary == {"prospects": 1, "conversations": 1}
    done = await client.delete(f"{API}/demo/data")
    assert done.json() == {"prospects": 1, "conversations": 1}
    left = (await client.get(f"{API}/prospects")).json()
    assert [p["first_name"] for p in left["items"]] == ["Bob"]
    assert (await client.get(f"{API}/prospects/{real}/conversation")).status_code == 200
    assert (await client.get(f"{API}/prospects/{fake}")).status_code == 404


async def test_purge_is_refused_in_production(client):
    await make(client, "sim.alice@demo.example.com")
    production = get_settings().model_copy(update={"environment": "production"})
    app.dependency_overrides[get_settings] = lambda: production
    assert (await client.delete(f"{API}/demo/data")).status_code == 403
    assert (await client.get(f"{API}/prospects", params={"demo": "only"})).json()["total"] == 1


async def test_demo_endpoints_are_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/demo")).status_code == 403
    assert (await advisor.delete(f"{API}/demo/data")).status_code == 403
