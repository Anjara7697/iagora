"""Durcissement avant production : limitation de connexion, erreurs, bail des tâches de fond."""

import logging

import pytest
from app.config import Settings
from app.core.ratelimit import LoginLimiter
from app.main import create_app
from app.services import lease
from httpx import ASGITransport, AsyncClient

API = "/api/v1"
PROD = {
    "environment": "production",
    "jwt_secret_key": "x" * 40,
    "connectors_secret_key": "k" * 40,
    "cors_origins": ["https://console.datum.example"],
}


def test_production_refuses_unsafe_settings():
    Settings(_env_file=None, **PROD)
    with pytest.raises(ValueError, match="DEBUG"):
        Settings(_env_file=None, debug=True, **PROD)
    for origin in ("*", "http://localhost:3000", "http://127.0.0.1:3000"):
        with pytest.raises(ValueError, match="CORS_ORIGINS"):
            Settings(_env_file=None, **{**PROD, "cors_origins": [origin]})


def test_limiter_blocks_after_repeated_failures_then_recovers():
    lim = LoginLimiter(max_failures=3, window=60)
    for t in (0, 1, 2):
        assert lim.retry_after("1.2.3.4", "Alice", now=t) == 0
        lim.record_failure("1.2.3.4", "Alice", now=t)
    assert lim.retry_after("1.2.3.4", " alice ", now=3) > 0  # bloqué (casse et espaces ignorés)
    assert lim.retry_after("1.2.3.4", "bob", now=3) == 0  # autre identifiant : libre
    assert lim.retry_after("1.2.3.4", "Alice", now=100) == 0  # fenêtre écoulée
    lim.record_failure("1.2.3.4", "Alice", now=100)
    lim.reset("1.2.3.4", "Alice")
    assert lim.retry_after("1.2.3.4", "Alice", now=101) == 0


def test_limiter_blocks_an_identifier_attacked_from_many_addresses(caplog):
    """AUDIT-SEC-005 : la limite par identifiant vaut toutes adresses confondues."""
    caplog.set_level(logging.WARNING, logger="app.core.ratelimit")
    lim = LoginLimiter(max_failures=5, window=60, per_username=4, per_ip=100)
    for i in range(4):
        lim.record_failure(f"10.0.0.{i}", "alice", now=i)
    assert lim.retry_after("10.0.0.99", "alice", now=5) > 0  # adresse jamais vue : bloquée
    assert lim.retry_after("10.0.0.99", "bob", now=5) == 0
    # Le blocage est journalisé sans l'identifiant en clair.
    assert "(user)" in caplog.text and "alice" not in caplog.text


def test_limiter_blocks_an_address_spraying_many_identifiers():
    lim = LoginLimiter(max_failures=5, window=60, per_username=100, per_ip=3)
    for i, name in enumerate(("alice", "bob", "chloe")):
        lim.record_failure("6.6.6.6", name, now=i)
    assert lim.retry_after("6.6.6.6", "david", now=4) > 0
    assert lim.retry_after("7.7.7.7", "david", now=4) == 0
    # Se connecter à son propre compte n'efface pas le compteur de l'adresse.
    lim.reset("6.6.6.6", "david")
    assert lim.retry_after("6.6.6.6", "emma", now=5) > 0


async def test_login_is_blocked_after_five_failures(client, make_client):
    anonymous = await make_client(None)
    codes = []
    for _ in range(7):
        r = await anonymous.post(f"{API}/auth/login", data={"username": "ghost", "password": "x"})
        codes.append(r.status_code)
    assert codes[:5] == [401] * 5 and codes[5:] == [429, 429]
    assert "Retry-After" in r.headers


async def test_unexpected_errors_never_leak_details(client, monkeypatch):
    from app.api.v1 import demo

    async def boom(*_a, **_k):
        raise RuntimeError("mot de passe=secret dans la trace")

    monkeypatch.setattr(demo.demo, "summary", boom)
    from app.main import app

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(
        transport=transport, base_url="http://test", headers=client.headers
    ) as c:
        r = await c.get(f"{API}/demo")
    assert r.status_code == 500 and r.json()["detail"] == "Erreur interne du serveur"
    assert set(r.json()) == {"detail", "request_id"} and r.json()["request_id"]  # AUDIT-API-002
    assert "secret" not in r.text


def test_interactive_docs_are_off_in_production(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "get_settings", lambda: Settings(_env_file=None, **PROD))
    prod = create_app()
    assert prod.docs_url is None and prod.openapi_url is None
    monkeypatch.setattr(main, "get_settings", lambda: Settings(_env_file=None))
    assert create_app().docs_url == "/docs"


async def test_only_one_instance_holds_a_background_lease(mongo_db):
    assert await lease.acquire(mongo_db, "email-worker", 60, holder="a") is True
    assert await lease.acquire(mongo_db, "email-worker", 60, holder="b") is False
    assert await lease.acquire(mongo_db, "email-worker", 60, holder="a") is True  # renouvelé
    await mongo_db[lease.COLLECTION].update_one(
        {"_id": "email-worker"}, {"$set": {"expires_at": 0}}
    )
    # un bail expiré (instance arrêtée) est repris
    from datetime import UTC, datetime, timedelta

    await mongo_db[lease.COLLECTION].update_one(
        {"_id": "email-worker"}, {"$set": {"expires_at": datetime.now(UTC) - timedelta(seconds=1)}}
    )
    assert await lease.acquire(mongo_db, "email-worker", 60, holder="b") is True
