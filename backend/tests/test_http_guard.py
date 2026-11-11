"""En-têtes de sécurité et refus des requêtes trop volumineuses (AUDIT-SEC-003, AUDIT-API-003)."""

import pytest
from app.core.http_guard import SECURITY_HEADERS
from app.main import app
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _assert_security_headers(response) -> None:
    for name, value in SECURITY_HEADERS:
        assert response.headers.get(name.decode()) == value.decode()


async def test_security_headers_on_every_response(client):
    _assert_security_headers(await client.get("/api/v1/health"))
    _assert_security_headers(await client.get("/api/v1/prospects"))  # 401 sans jeton


async def test_security_headers_on_cors_preflight(client):
    r = await client.options(
        "/api/v1/health",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert r.status_code == 200
    _assert_security_headers(r)


async def test_oversized_request_is_refused_before_reading_the_body(client):
    r = await client.post(
        "/api/v1/auth/login",
        content=b"x",
        headers={"Content-Length": "999999999", "Content-Type": "application/json"},
    )
    assert r.status_code == 413
    assert r.json() == {"detail": "Requête trop volumineuse"}
    _assert_security_headers(r)


async def test_request_under_the_limit_reaches_the_route(client):
    r = await client.post(
        "/api/v1/health", content=b"{}", headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 405  # la route existe en GET : la requête a bien été transmise
    _assert_security_headers(r)
