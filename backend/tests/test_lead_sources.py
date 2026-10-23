"""Sources de leads : jetons de service (formulaire du site, n8n) et import CSV."""

from app.models.enums import UserRole
from app.services import service_tokens
from app.services.prospect_import import map_columns, read_rows

API = "/api/v1"


async def _campaign(client):
    r = await client.post(
        f"{API}/campaigns",
        json={
            "name": "Rentrée 2027",
            "status": "active",
            "target_codes": ["ebihar_students"],
            "sources": [{"name": "Site", "type": "form", "platform": "web"}],
        },
    )
    body = r.json()
    return body["id"], body["sources"][0]["id"]


async def _token(client, **over):
    cid, sid = await _campaign(client)
    r = await client.post(
        f"{API}/integrations/tokens",
        json={"name": "Formulaire du site", "campaign_id": cid, "source_id": sid, **over},
    )
    assert r.status_code == 201, r.text
    return r.json(), cid


# --- Jetons de service --------------------------------------------------------------------------


async def test_token_is_shown_once_and_stored_as_a_hash(client, mongo_db):
    created, _ = await _token(client)
    token = created["token"]
    assert token.startswith("iag_") and created["hint"].endswith("…")
    listed = await client.get(f"{API}/integrations/tokens")
    assert token not in listed.text and listed.json()[0]["name"] == "Formulaire du site"
    stored = await mongo_db["service_tokens"].find_one({})
    assert token not in str(stored)


async def test_form_lead_is_received_with_the_token_destination(client, make_client):
    created, campaign_id = await _token(client)
    anon = await make_client(None)
    lead = {
        "first_name": "Inès",
        "email": "ines@exemple.fr",
        "message": "Bonjour, je veux des infos sur eBIHAR",
        "consent": True,
    }
    r = await anon.post(
        f"{API}/leads", json=lead, headers={"Authorization": f"Bearer {created['token']}"}
    )
    assert r.status_code == 201 and r.json()["created"] is True
    pid = r.json()["prospect_id"]
    prospect = (await client.get(f"{API}/prospects/{pid}")).json()
    assert prospect["consent_status"] == "granted"
    assert prospect["campaigns"][0]["campaign_id"] == campaign_id
    again = await anon.post(f"{API}/leads", json=lead, headers={"X-API-Key": created["token"]})
    assert again.status_code == 200 and again.json() == {"prospect_id": pid, "created": False}


async def test_missing_wrong_or_revoked_token_is_refused(client, make_client):
    created, _ = await _token(client)
    anon = await make_client(None)
    lead = {"email": "a@exemple.fr"}
    assert (await anon.post(f"{API}/leads", json=lead)).status_code == 401
    bad = {"X-API-Key": "iag_faux"}
    assert (await anon.post(f"{API}/leads", json=lead, headers=bad)).status_code == 401
    assert (await client.delete(f"{API}/integrations/tokens/{created['id']}")).status_code == 204
    revoked = {"X-API-Key": created["token"]}
    assert (await anon.post(f"{API}/leads", json=lead, headers=revoked)).status_code == 401
    # Un jeton de session de la console n'ouvre pas la réception publique.
    assert (await client.post(f"{API}/leads", json=lead)).status_code == 401


async def test_invalid_destination_is_refused_at_creation(client):
    r = await client.post(
        f"{API}/integrations/tokens", json={"name": "x-form", "campaign_id": 999, "source_id": 1}
    )
    assert r.status_code == 422
    unknown = await client.post(
        f"{API}/integrations/tokens", json={"name": "x-form", "channel": "pigeon"}
    )
    assert unknown.status_code == 422


def test_rate_limit_per_token():
    assert all(service_tokens.allow("t1", now=100.0 + i * 0.1) for i in range(60))
    assert not service_tokens.allow("t1", now=106.5)
    assert service_tokens.allow("t1", now=170.0)


async def test_tokens_are_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/integrations/tokens")).status_code == 403
    assert (
        await advisor.post(f"{API}/integrations/tokens", json={"name": "abc"})
    ).status_code == 403


# --- Import CSV ---------------------------------------------------------------------------------

CSV = (
    "Prénom;Nom;E-mail;Téléphone;Ville;Remarque\n"
    "Jean;Dupont;jean@exemple.fr;06 12 34 56 78;Lyon;salon\n"
    "Marie;Curie;marie@exemple.fr;;Paris;\n"
    "Jean;Dupont;JEAN@exemple.fr;;;doublon dans le fichier\n"
    "Sans;Contact;;;;\n"
    "Bad;Mail;pas-un-email;;;\n"
).encode("cp1252")


def test_columns_are_recognised_from_french_headers():
    headers, rows = read_rows(CSV.decode("cp1252"))
    mapping = map_columns(headers)
    assert mapping["Prénom"] == "first_name" and mapping["E-mail"] == "email"
    assert mapping["Téléphone"] == "phone" and mapping["Ville"] == "profile.city"
    assert mapping["Remarque"] == "(ignorée)" and len(rows) == 5


async def _import(client, data, **form):
    return await client.post(
        f"{API}/prospects/import",
        files={"file": ("salon.csv", data, "text/csv")},
        data={k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in form.items()},
    )


async def test_preview_then_import(client):
    cid, sid = await _campaign(client)
    preview = await _import(client, CSV, dry_run=True, campaign_id=cid, source_id=sid)
    report = preview.json()
    assert report["dry_run"] is True and report["total"] == 5
    assert (report["created"], report["existing"]) == (2, 1)
    assert [e["row"] for e in report["invalid"]] == [5, 6]
    assert (await client.get(f"{API}/prospects")).json()["total"] == 0  # rien d'enregistré

    done = await _import(client, CSV, dry_run=False, campaign_id=cid, source_id=sid, consent=True)
    assert (done.json()["created"], done.json()["existing"]) == (2, 1)
    listed = (await client.get(f"{API}/prospects")).json()
    assert listed["total"] == 2
    jean = next(p for p in listed["items"] if p["first_name"] == "Jean")
    assert jean["profile"]["city"] == "Lyon" and jean["consent_status"] == "granted"
    assert jean["campaigns"][0]["campaign_id"] == cid
    # Réimport : tout est reconnu, aucun doublon créé.
    again = await _import(client, CSV, dry_run=False, campaign_id=cid, source_id=sid)
    assert again.json()["created"] == 0
    assert (await client.get(f"{API}/prospects")).json()["total"] == 2


async def test_import_refuses_files_without_contact_column(client):
    r = await _import(client, b"nom,ville\nDupont,Lyon\n")
    assert r.status_code == 422 and "email" in r.json()["detail"]


async def test_viewer_cannot_import(make_client):
    viewer = await make_client(UserRole.VIEWER)
    assert (await _import(viewer, CSV)).status_code == 403


async def test_unknown_programme_is_reported_in_the_preview(client):
    data = b"email;programme\na@exemple.fr;inconnu\nb@exemple.fr;ebihar_students\n"
    report = (await _import(client, data, dry_run=True)).json()
    assert report["created"] == 1 and report["invalid"][0]["row"] == 2
