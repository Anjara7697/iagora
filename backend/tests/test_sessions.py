"""Lot 10 : session en témoin HttpOnly, anti-CSRF, révocation (AUDIT-SEC-004, AUDIT-SEC-009)."""

from datetime import UTC, datetime, timedelta

from app.api import cookies
from app.config import Settings, get_settings
from app.core.security import create_access_token, decode_access_claims
from app.models import AuthSession
from app.models.enums import UserRole
from fastapi import Response
from sqlalchemy import func, select

from .conftest import PASSWORD

API = "/api/v1"
CSRF = {cookies.CSRF_HEADER: "1"}


async def _login(client, identifier="advisor@example.com", password=PASSWORD):
    return await client.post(
        f"{API}/auth/login", data={"username": identifier, "password": password}
    )


async def test_login_sets_an_httponly_strict_cookie_that_authenticates(make_client):
    await make_client(UserRole.ADVISOR)
    browser = await make_client(None)
    r = await _login(browser)
    assert r.status_code == 200
    header = r.headers["set-cookie"].lower()
    assert header.startswith(f"{cookies.SESSION_COOKIE}=")
    assert "httponly" in header and "samesite=strict" in header and "path=/api/v1" in header
    assert "secure" not in header  # http en développement ; Secure en production (plus bas)
    # Aucun en-tête Authorization : le témoin suffit pour lire.
    me = await browser.get(f"{API}/auth/me")
    assert me.status_code == 200 and me.json()["role"] == "ADVISOR"


def test_session_cookie_is_secure_in_production():
    prod = Settings(
        _env_file=None,
        environment="production",
        jwt_secret_key="x" * 40,
        connectors_secret_key="k" * 40,
        cors_origins=["https://iagora.example.com"],
    )
    response = Response()
    cookies.set_session(response, prod, "jeton")
    cookies.set_oauth(response, prod, "calendar_oauth", "nonce")
    session_header, oauth_header = response.headers.getlist("set-cookie")
    assert "Secure" in session_header and "SameSite=strict" in session_header
    assert "Secure" in oauth_header and "SameSite=lax" in oauth_header
    # Instance d'essai servie en HTTPS (`dev`) : témoins `Secure` aussi.
    dev = Settings(_env_file=None, cors_origins=["https://dev.iagora.example.com"])
    response = Response()
    cookies.set_session(response, dev, "jeton")
    assert "Secure" in response.headers["set-cookie"]


async def test_cookie_writes_require_the_csrf_header(make_client):
    await make_client(UserRole.ADVISOR)
    browser = await make_client(None)
    await _login(browser)
    body = {"current_password": "pas-le-bon-mot-de-passe", "new_password": "nouveau-mot-de-passe-1"}
    # Un formulaire d'un autre site ne peut pas poser l'en-tête : refusé avant tout traitement.
    refused = await browser.post(f"{API}/auth/password", json=body)
    assert refused.status_code == 403
    # Avec l'en-tête, la requête est traitée (ici : mauvais mot de passe actuel).
    checked = await browser.post(f"{API}/auth/password", json=body, headers=CSRF)
    assert checked.status_code in (400, 422) and "incorrect" in checked.text


async def test_bearer_header_still_works_for_scripts_without_csrf(make_client):
    await make_client(UserRole.ADMIN)
    script = await make_client(None)
    token = (await _login(script, "admin@example.com")).json()["access_token"]
    script.cookies.clear()
    created = await script.post(
        f"{API}/prospects",
        json={"email": "script@demo.example.com"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert created.status_code == 201


async def test_logout_revokes_the_session_server_side(make_client):
    await make_client(UserRole.ADVISOR)
    browser = await make_client(None)
    token = (await _login(browser)).json()["access_token"]
    out = await browser.post(f"{API}/auth/logout")
    assert out.status_code == 204
    assert f"{cookies.SESSION_COOKIE}=" in out.headers["set-cookie"]
    assert not browser.cookies.get(cookies.SESSION_COOKIE)  # témoin effacé
    # Un jeton copié avant la déconnexion ne sert plus (AUDIT-SEC-009).
    copied = await browser.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert copied.status_code == 401
    # Les autres sessions du même compte restent ouvertes.
    other = await make_client(None)
    await _login(other)
    assert (await other.get(f"{API}/auth/me")).status_code == 200


async def test_logout_without_session_still_succeeds(make_client):
    anon = await make_client(None)
    assert (await anon.post(f"{API}/auth/logout")).status_code == 204
    garbage = await anon.post(f"{API}/auth/logout", headers={"Authorization": "Bearer x"})
    assert garbage.status_code == 204


async def test_token_without_open_session_is_refused(make_client, session_factory):
    advisor = await make_client(UserRole.ADVISOR)
    uid = (await advisor.get(f"{API}/auth/me")).json()["id"]
    anon = await make_client(None)
    forged = create_access_token(uid, get_settings())  # signé, mais sans session ouverte
    r = await anon.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401
    unknown = create_access_token(uid, get_settings(), session_id="0" * 32)
    r = await anon.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {unknown}"})
    assert r.status_code == 401


async def test_expired_sessions_are_refused_and_purged(make_client, session_factory):
    await make_client(UserRole.ADVISOR)
    browser = await make_client(None)
    token = (await _login(browser)).json()["access_token"]
    sid = decode_access_claims(token, get_settings()).session_id
    async with session_factory() as s:
        record = await s.get(AuthSession, sid)
        record.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        await s.commit()
    assert (await browser.get(f"{API}/auth/me")).status_code == 401
    await _login(browser)  # nouvelle connexion : la session expirée est supprimée
    async with session_factory() as s:
        assert await s.get(AuthSession, sid) is None
        count = await s.scalar(select(func.count()).select_from(AuthSession))
    assert count >= 1


async def test_password_change_renews_the_cookie_and_closes_old_sessions(make_client):
    await make_client(UserRole.ADVISOR)
    browser = await make_client(None)
    old = (await _login(browser)).json()["access_token"]
    other = await make_client(None)
    await _login(other)
    changed = await browser.post(
        f"{API}/auth/password",
        json={"current_password": PASSWORD, "new_password": "un-autre-mot-de-passe-7"},
        headers=CSRF,
    )
    assert changed.status_code == 200
    assert cookies.SESSION_COOKIE in changed.headers["set-cookie"]
    assert (await browser.get(f"{API}/auth/me")).status_code == 200  # témoin renouvelé
    stale = await browser.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {old}"})
    assert stale.status_code == 401
    assert (await other.get(f"{API}/auth/me")).status_code == 401
