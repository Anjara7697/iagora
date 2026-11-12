"""Cloisonnement des prospects par campagne (AUDIT-SEC-006, décision D-23)."""

from app.models.enums import UserRole

from .test_campaigns_api import _create

API = "/api/v1"


async def _setup(client, make_client):
    alice = await make_client(UserRole.ADVISOR)
    alice_id = (await alice.get(f"{API}/auth/me")).json()["id"]
    bob_id = (
        await client.post(f"{API}/users", json={"username": "bob", "email": "bob@example.com"})
    ).json()["id"]
    camp_a = (await _create(client, name="Campagne A")).json()
    camp_b = (await _create(client, name="Campagne B")).json()
    for camp, owner in ((camp_a, alice_id), (camp_b, bob_id)):
        r = await client.put(
            f"{API}/campaigns/{camp['id']}/responsible",
            json={"advisor_id": owner, "existing_prospects": "transfer_inherited"},
        )
        assert r.status_code == 200

    async def lead(camp, email):
        body = {
            "email": email,
            "channel": "email",
            "message": "Bonjour, des infos ?",
            "campaign_id": camp["id"],
            "source_id": camp["sources"][0]["id"],
        }
        return (await client.post(f"{API}/prospects", json=body)).json()["prospect"]

    mine = await lead(camp_a, "a@example.com")
    other = await lead(camp_b, "b@example.com")
    pending = (await client.post(f"{API}/prospects", json={"email": "p@example.com"})).json()[
        "prospect"
    ]
    return alice, alice_id, mine, other, pending


async def test_an_advisor_sees_only_the_prospects_of_his_campaigns(client, make_client):
    alice, _, mine, other, pending = await _setup(client, make_client)
    ids = [p["id"] for p in (await alice.get(f"{API}/prospects")).json()["items"]]
    assert ids == [mine["id"]]
    # Hors périmètre : « introuvable », sans révéler l'existence de la fiche.
    for pid in (other["id"], pending["id"]):
        assert (await alice.get(f"{API}/prospects/{pid}")).status_code == 404
        assert (await alice.get(f"{API}/prospects/{pid}/conversation")).status_code == 404
        assert (await alice.patch(f"{API}/prospects/{pid}", json={"city": "x"})).status_code == 404
    # File « À attribuer » : administrateur seulement.
    assert (await alice.get(f"{API}/prospects?pending_campaign=true")).json()["total"] == 0
    assert (await client.get(f"{API}/prospects?pending_campaign=true")).json()["total"] == 1
    # Conversations : même périmètre, en liste comme en accès direct.
    convs = (await alice.get(f"{API}/conversations")).json()["items"]
    assert {c["prospect_id"] for c in convs} == {mine["id"]}
    other_conv = (await client.get(f"{API}/prospects/{other['id']}/conversation")).json()["id"]
    assert (await alice.get(f"{API}/conversations/{other_conv}")).status_code == 404
    message = {"role": "advisor", "content": "Bonjour"}
    sent = await alice.post(f"{API}/conversations/{other_conv}/messages", json=message)
    assert sent.status_code == 404
    # Export CSV : seulement ses prospects.
    export = (await alice.get(f"{API}/prospects/export?demo=all")).text
    assert "a@example.com" in export and "b@example.com" not in export


async def test_an_individual_assignment_extends_the_scope(client, make_client):
    alice, alice_id, _, other, _ = await _setup(client, make_client)
    mid = other["campaigns"][0]["id"]
    body = {"assigned_advisor_id": alice_id}
    r = await client.patch(f"{API}/campaign-prospects/{mid}", json=body)
    assert r.status_code == 200
    assert (await alice.get(f"{API}/prospects/{other['id']}")).status_code == 200
    assert (await alice.get(f"{API}/prospects")).json()["total"] == 2


async def test_admin_and_viewer_see_everything(client, make_client):
    await _setup(client, make_client)
    viewer = await make_client(UserRole.VIEWER)
    assert (await client.get(f"{API}/prospects")).json()["total"] == 3
    assert (await viewer.get(f"{API}/prospects")).json()["total"] == 3
