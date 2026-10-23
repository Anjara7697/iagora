"""Gestion de l'équipe : mots de passe temporaires, réinitialisation, révocation des sessions."""

from app.models.enums import UserRole

from .conftest import PASSWORD

API = "/api/v1"


async def _login(client, identifier, password):
    r = await client.post(f"{API}/auth/login", data={"username": identifier, "password": password})
    return r


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_new_member_gets_a_one_time_password_and_must_change_it(make_client):
    admin = await make_client(UserRole.ADMIN)
    anon = await make_client(None)
    r = await admin.post(f"{API}/users", json={"username": "lea", "email": "lea@example.com"})
    assert r.status_code == 201
    temp = r.json()["temporary_password"]
    assert temp and len(temp) == 16 and r.json()["must_change_password"] is True
    listed = (await admin.get(f"{API}/users")).json()
    assert temp not in str(listed)  # affiché une seule fois
    token = (await _login(anon, "lea@example.com", temp)).json()["access_token"]
    me = await anon.get(f"{API}/auth/me", headers=_auth(token))
    assert me.status_code == 200 and me.json()["must_change_password"] is True
    assert (await anon.get(f"{API}/prospects", headers=_auth(token))).status_code == 403
    new = await anon.post(
        f"{API}/auth/password",
        json={"current_password": temp, "new_password": "lea-own-password-1"},
        headers=_auth(token),
    )
    fresh = new.json()["access_token"]
    assert (await anon.get(f"{API}/prospects", headers=_auth(fresh))).status_code == 200
    assert (await anon.get(f"{API}/auth/me", headers=_auth(token))).status_code == 401
    assert (await _login(anon, "lea@example.com", temp)).status_code == 401


async def test_admin_reset_closes_sessions_and_cannot_target_self(make_client):
    admin = await make_client(UserRole.ADMIN)
    advisor = await make_client(UserRole.ADVISOR)
    uid = (await advisor.get(f"{API}/auth/me")).json()["id"]
    r = await admin.post(f"{API}/users/{uid}/reset-password")
    assert r.status_code == 200 and len(r.json()["temporary_password"]) == 16
    assert (await advisor.get(f"{API}/auth/me")).status_code == 401
    me = (await admin.get(f"{API}/auth/me")).json()["id"]
    assert (await admin.post(f"{API}/users/{me}/reset-password")).status_code == 422
    assert (await admin.post(f"{API}/users/999/reset-password")).status_code == 404


async def test_changing_own_password_checks_the_current_one(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    wrong = await advisor.post(
        f"{API}/auth/password",
        json={"current_password": "pas-le-bon-mdp", "new_password": "nouveau-mot-de-passe-1"},
    )
    assert wrong.status_code == 422
    same = await advisor.post(
        f"{API}/auth/password", json={"current_password": PASSWORD, "new_password": PASSWORD}
    )
    assert same.status_code == 422
    short = await advisor.post(
        f"{API}/auth/password", json={"current_password": PASSWORD, "new_password": "court"}
    )
    assert short.status_code == 422


async def test_admin_edits_email_and_duplicates_are_refused(make_client):
    admin = await make_client(UserRole.ADMIN)
    advisor = await make_client(UserRole.ADVISOR)
    uid = (await advisor.get(f"{API}/auth/me")).json()["id"]
    ok = await admin.patch(f"{API}/users/{uid}", json={"email": "Nouveau@Example.com"})
    assert ok.status_code == 200 and ok.json()["email"] == "nouveau@example.com"
    taken = await admin.patch(f"{API}/users/{uid}", json={"email": "admin@example.com"})
    assert taken.status_code == 409


async def test_team_management_is_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    body = {"username": "x-user", "email": "x@example.com"}
    assert (await advisor.post(f"{API}/users", json=body)).status_code == 403
    assert (await advisor.post(f"{API}/users/1/reset-password")).status_code == 403
