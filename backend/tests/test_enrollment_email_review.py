"""Une preuve email détectée reste soumise à une confirmation humaine."""

from app.models import Campaign, CampaignProspect, CampaignSource, Source
from app.models.enums import ConversionStage, UserRole
from app.services import conversations, todo

API = "/api/v1"


async def setup_case(client, session_factory, mongo_db):
    created = await client.post(
        f"{API}/prospects", json={"email": "admitted@demo.example.com", "channel": "email"}
    )
    prospect_id = created.json()["prospect"]["id"]
    async with session_factory() as session:
        campaign = Campaign(name="eBIHAR admission")
        source = Source(name="Dossier email", type="email", platform="email")
        session.add_all([campaign, source])
        await session.flush()
        link = CampaignSource(campaign_id=campaign.id, source_id=source.id)
        session.add(link)
        await session.flush()
        membership = CampaignProspect(
            prospect_id=prospect_id,
            campaign_source_id=link.id,
            conversion_stage=ConversionStage.APPLIED,
        )
        session.add(membership)
        await session.commit()
        membership_id = membership.id
    opened = await client.post(
        f"{API}/conversations", json={"prospect_id": prospect_id, "channel": "email"}
    )
    conversation_id = opened.json()["conversation"]["id"]
    await conversations.set_handoff(
        mongo_db,
        conversation_id,
        {
            "reason": "inscription_a_verifier",
            "summary": "Admission annoncée par email",
            "recommended_action": "Vérifier la preuve et confirmer l'inscription",
        },
    )
    return membership_id, conversation_id


async def test_advisor_confirms_detected_enrollment_and_clears_task(
    client, make_client, session_factory, mongo_db
):
    membership_id, conversation_id = await setup_case(client, session_factory, mongo_db)
    viewer = await make_client(UserRole.VIEWER)
    endpoint = f"{API}/conversations/{conversation_id}/confirm-enrollment-email"
    payload = {
        "membership_id": membership_id,
        "evidence_reference": "email admissions du 28 octobre",
        "note": "Identité et programme vérifiés",
    }
    assert (await viewer.post(endpoint, json=payload)).status_code == 403
    advisor = await make_client(UserRole.ADVISOR)
    response = await advisor.post(endpoint, json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "open"
    assert response.json()["handoff"] is None

    membership = (await client.get(f"{API}/campaign-prospects/{membership_id}")).json()
    assert membership["conversion_stage"] == "converted"
    history = (await client.get(f"{API}/campaign-prospects/{membership_id}/history")).json()
    assert "email admissions du 28 octobre" in history["stage_events"][-1]["reason"]
    async with session_factory() as session:
        queue = await todo.list_todo(session, mongo_db, kind="enrollment", limit=25, offset=0)
    assert queue.total == 0
    doc = await conversations.get_doc(mongo_db, conversation_id)
    assert doc["enrollment_reviews"][0]["membership_id"] == membership_id


async def test_enrollment_email_confirmation_rejects_wrong_stage(client, session_factory, mongo_db):
    membership_id, conversation_id = await setup_case(client, session_factory, mongo_db)
    async with session_factory() as session:
        membership = await session.get(CampaignProspect, membership_id)
        assert membership is not None
        membership.conversion_stage = ConversionStage.MEETING_DONE
        await session.commit()
    response = await client.post(
        f"{API}/conversations/{conversation_id}/confirm-enrollment-email",
        json={
            "membership_id": membership_id,
            "evidence_reference": "email admissions du 28 octobre",
        },
    )
    assert response.status_code == 409
    assert (await conversations.get_doc(mongo_db, conversation_id))["status"] == "handed_off"
