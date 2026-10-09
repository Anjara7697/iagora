import pytest
from app.main import app
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_liveness(client):
    r = await client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_readiness_ok(client, monkeypatch):
    async def ok():
        return {"postgres": True, "mongo": True, "redis": True}

    monkeypatch.setattr("app.api.v1.health.check_dependencies", ok)
    r = await client.get("/api/v1/health/ready")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_readiness_degraded(client, monkeypatch):
    async def ko():
        return {"postgres": True, "mongo": False, "redis": True}

    monkeypatch.setattr("app.api.v1.health.check_dependencies", ko)
    r = await client.get("/api/v1/health/ready")
    assert r.status_code == 503
    assert r.json()["dependencies"]["mongo"] is False
