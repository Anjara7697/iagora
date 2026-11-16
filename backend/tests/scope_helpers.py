"""Cloisonnement (décision D-23) : un conseiller n'agit que sur les prospects de son périmètre.
Les tests qui font agir un conseiller lui confient d'abord la campagne du prospect."""

API = "/api/v1"


async def entrust(admin, advisor, prospect_id: int) -> int:
    """Rend `advisor` responsable de la (première) campagne du prospect ; renvoie son id."""
    advisor_id = (await advisor.get(f"{API}/auth/me")).json()["id"]
    prospect = (await admin.get(f"{API}/prospects/{prospect_id}")).json()
    if not prospect["campaigns"]:
        # Prospect « À attribuer » : l'administrateur l'attribue d'abord à une campagne.
        from .test_campaigns_api import _create

        campaign = (await _create(admin, name=f"Campagne {prospect_id}")).json()
        link = {"campaign_id": campaign["id"], "source_id": campaign["sources"][0]["id"]}
        prospect = (await admin.post(f"{API}/prospects/{prospect_id}/campaigns", json=link)).json()
    campaign_id = prospect["campaigns"][0]["campaign_id"]
    r = await admin.put(
        f"{API}/campaigns/{campaign_id}/responsible",
        json={"advisor_id": advisor_id, "existing_prospects": "transfer_inherited"},
    )
    assert r.status_code == 200, r.text
    return advisor_id


async def entrust_membership(admin, advisor, membership_id: int) -> int:
    """Comme `entrust`, à partir d'un rattachement (campaign-prospect)."""
    page = (await admin.get(f"{API}/prospects", params={"limit": 200})).json()
    prospect_id = next(
        p["id"] for p in page["items"] if any(m["id"] == membership_id for m in p["campaigns"])
    )
    return await entrust(admin, advisor, prospect_id)
