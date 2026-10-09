import jwt
import pytest
from app.config import DEV_JWT_SECRET, Settings, get_settings
from app.core.security import create_access_token, decode_access_token, verify_password
from app.models.enums import UserRole

from .conftest import PASSWORD

API = "/api/v1"


async def _login(client, identifier, password=PASSWORD):
    return await client.post(
        f"{API}/auth/login", data={"username": identifier, "password": password}
    )


async def test_login_by_email_or_username_and_me(make_client):
    anon = await make_client(None)
    await make_client(UserRole.ADVISOR)  # crée advisor@example.com
    for ident in ("advisor@example.com", "ADVISOR-USER"):
        r = await _login(anon, ident)
        assert r.status_code == 200
        token = r.json()["access_token"]
        me = await anon.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.json()["role"] == "ADVISOR"
        assert "password" not in me.text and "hashed" not in me.text


async def test_login_failures_are_uniform(make_client):
    anon = await make_client(None)
    await make_client(UserRole.VIEWER)
    wrong = await _login(anon, "viewer@example.com", "wrong-password-123")
    unknown = await _login(anon, "nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # ne révèle pas si le compte existe


async def test_inactive_user_cannot_login_or_use_token(make_client, client):
    anon = await make_client(None)
    advisor = await make_client(UserRole.ADVISOR)
    uid = (await advisor.get(f"{API}/auth/me")).json()["id"]
    assert (await client.patch(f"{API}/users/{uid}", json={"is_active": False})).status_code == 200
    assert (await _login(anon, "advisor@example.com")).status_code == 401
    assert (await advisor.get(f"{API}/auth/me")).status_code == 401  # jeton déjà émis


async def test_protected_routes_require_authentication(make_client):
    anon = await make_client(None)
    for method, path in [("get", "/prospects"), ("get", "/campaigns"), ("get", "/users")]:
        r = await getattr(anon, method)(f"{API}{path}")
        assert r.status_code == 401
    assert (await anon.get(f"{API}/health")).status_code == 200  # santé publique
    bad = await anon.get(f"{API}/prospects", headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401


async def test_role_matrix(make_client):
    viewer = await make_client(UserRole.VIEWER)
    advisor = await make_client(UserRole.ADVISOR)
    admin = await make_client(UserRole.ADMIN)
    lead = {"email": "a@example.com"}

    # lecture : tous les rôles
    for c in (viewer, advisor, admin):
        assert (await c.get(f"{API}/prospects")).status_code == 200
        assert (await c.get(f"{API}/campaigns")).status_code == 200
    # écriture commerciale : ADMIN et ADVISOR, pas VIEWER
    assert (await viewer.post(f"{API}/prospects", json=lead)).status_code == 403
    created = await advisor.post(f"{API}/prospects", json=lead)
    assert created.status_code == 201
    pid = created.json()["prospect"]["id"]
    assert (await viewer.post(f"{API}/prospects/{pid}/opt-out", json={})).status_code == 403
    assert (
        await viewer.patch(f"{API}/prospects/{pid}", json={"last_name": "x"})
    ).status_code == 403
    assert (
        await advisor.patch(f"{API}/prospects/{pid}", json={"last_name": "x"})
    ).status_code == 200
    # campagnes et comptes : ADMIN seulement
    campaign = {"name": "c"}
    assert (await advisor.post(f"{API}/campaigns", json=campaign)).status_code == 403
    assert (await admin.post(f"{API}/campaigns", json=campaign)).status_code == 201
    assert (await advisor.get(f"{API}/users")).status_code == 403
    assert (await viewer.get(f"{API}/users")).status_code == 403


async def test_admin_creates_user_who_can_login(make_client):
    admin = await make_client(UserRole.ADMIN)
    anon = await make_client(None)
    body = {"username": "marie", "email": "Marie@Example.com", "password": "a-long-password-1"}
    r = await admin.post(f"{API}/users", json=body)
    assert r.status_code == 201
    assert r.json()["email"] == "marie@example.com" and r.json()["role"] == "ADVISOR"
    assert "password" not in r.text
    assert (await _login(anon, "marie@example.com", "a-long-password-1")).status_code == 200
    dup = await admin.post(f"{API}/users", json={**body, "username": "marie2"})
    assert dup.status_code == 409


async def test_weak_password_rejected(make_client):
    admin = await make_client(UserRole.ADMIN)
    r = await admin.post(
        f"{API}/users", json={"username": "bob", "email": "b@example.com", "password": "short"}
    )
    assert r.status_code == 422


async def test_admin_cannot_demote_or_deactivate_self(make_client):
    admin = await make_client(UserRole.ADMIN)
    me = (await admin.get(f"{API}/auth/me")).json()["id"]
    assert (await admin.patch(f"{API}/users/{me}", json={"role": "VIEWER"})).status_code == 422
    assert (await admin.patch(f"{API}/users/{me}", json={"is_active": False})).status_code == 422
    assert (await admin.patch(f"{API}/users/{me}", json={"username": "renamed"})).status_code == 200
    assert (await admin.get(f"{API}/users/999")).status_code == 404


async def test_admin_can_reset_password_and_change_role(make_client):
    admin = await make_client(UserRole.ADMIN)
    anon = await make_client(None)
    viewer = await make_client(UserRole.VIEWER)
    uid = (await viewer.get(f"{API}/auth/me")).json()["id"]
    r = await admin.patch(
        f"{API}/users/{uid}", json={"password": "brand-new-password-1", "role": "ADVISOR"}
    )
    assert r.json()["role"] == "ADVISOR"
    assert (await _login(anon, "viewer@example.com")).status_code == 401  # ancien mot de passe
    assert (await _login(anon, "viewer@example.com", "brand-new-password-1")).status_code == 200
    assert (
        await viewer.post(f"{API}/prospects", json={"email": "z@example.com"})
    ).status_code == 201


def test_token_rejects_tampering_expiry_and_wrong_secret():
    settings = get_settings()
    token = create_access_token(42, settings)
    assert decode_access_token(token, settings) == 42
    assert decode_access_token(token + "x", settings) is None
    other = Settings(_env_file=None, jwt_secret_key="another-secret-another-secret-123456")
    assert decode_access_token(token, other) is None
    expired = jwt.encode({"sub": "1", "exp": 1}, DEV_JWT_SECRET, algorithm="HS256")
    assert decode_access_token(expired, settings) is None
    no_sub = jwt.encode({"exp": 9999999999}, DEV_JWT_SECRET, algorithm="HS256")
    assert decode_access_token(no_sub, settings) is None
    none_alg = jwt.encode({"sub": "1", "exp": 9999999999}, key="", algorithm="none")
    assert decode_access_token(none_alg, settings) is None


def test_password_hash_is_not_plaintext_and_verifies():
    from app.core.security import hash_password

    hashed = hash_password("a-long-password-1")
    assert "a-long-password-1" not in hashed and hashed.startswith("$argon2")
    assert verify_password("a-long-password-1", hashed)
    assert not verify_password("other", hashed)
    assert not verify_password("a-long-password-1", "not-a-hash")


def test_production_requires_real_jwt_secret():
    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        Settings(_env_file=None, environment="production")
    with pytest.raises(ValueError):
        Settings(_env_file=None, environment="production", jwt_secret_key="too-short")
    ok = Settings(_env_file=None, environment="production", jwt_secret_key="x" * 40)
    assert ok.environment == "production"
    with pytest.raises(ValueError):
        Settings(_env_file=None, jwt_secret_key="")
