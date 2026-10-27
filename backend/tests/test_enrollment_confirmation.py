"""Une inscription exige une candidature et une preuve attestée par un conseiller."""

from app.models.enums import UserRole

API = "/api/v1"


async def _membership(client):
    campaign = (
        await client.post(
            f"{API}/campaigns",
            json={
                "name": "Recrutement eBIHAR",
                "status": "active",
                "target_codes": ["ebihar_students"],
                "sources": [{"name": "Formulaire", "type": "web", "platform": "web"}],
            },
        )
    ).json()
    received = await client.post(
        f"{API}/prospects",
        json={
            "email": "candidate@demo.example.com",
            "channel": "web_form",
            "campaign_id": campaign["id"],
            "source_id": campaign["sources"][0]["id"],
            "consent_granted": True,
            "consent_source": "formulaire",
        },
    )
    assert received.status_code == 201
    return received.json()["prospect"]["campaigns"][0]["id"]


async def test_confirmation_requires_application_and_records_evidence(client, make_client):
    membership = await _membership(client)
    endpoint = f"{API}/campaign-prospects/{membership}"
    proof = {
        "evidence_type": "school_email",
        "evidence_reference": "email admissions du 27 octobre",
    }
    assert (await client.post(f"{endpoint}/confirm-enrollment", json=proof)).status_code == 409
    bypass = await client.patch(
        endpoint, json={"conversion_stage": "converted", "reason": "Inscription confirmée"}
    )
    assert bypass.status_code == 422
    applied = await client.patch(
        endpoint, json={"conversion_stage": "applied", "reason": "Dossier reçu et vérifié"}
    )
    assert applied.status_code == 200
    viewer = await make_client(UserRole.VIEWER)
    assert (await viewer.post(f"{endpoint}/confirm-enrollment", json=proof)).status_code == 403
    advisor = await make_client(UserRole.ADVISOR)
    confirmed = await advisor.post(f"{endpoint}/confirm-enrollment", json=proof)
    assert confirmed.status_code == 200
    assert confirmed.json()["conversion_stage"] == "converted"
    history = (await client.get(f"{endpoint}/history")).json()["stage_events"]
    assert history[-1]["from_stage"] == "applied"
    assert "email admissions du 27 octobre" in history[-1]["reason"]
    assert history[-1]["actor_user_id"] is not None
    assert (await advisor.post(f"{endpoint}/confirm-enrollment", json=proof)).status_code == 409


async def test_confirmation_rejects_blank_evidence(client):
    membership = await _membership(client)
    endpoint = f"{API}/campaign-prospects/{membership}/confirm-enrollment"
    result = await client.post(
        endpoint, json={"evidence_type": "other", "evidence_reference": "          "}
    )
    assert result.status_code == 422
