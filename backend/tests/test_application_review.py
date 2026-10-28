"""La file Candidatures ne se vide qu'après vérification humaine du bon parcours."""

from app.models import Campaign, CampaignProspect, CampaignSource, Source
from app.models.enums import ConversionStage, UserRole
from app.services import conversations, todo

API = "/api/v1"


async def case(client, session_factory, mongo_db):
    prospect = await client.post(
        f"{API}/prospects", json={"email": "candidate@demo.example.com", "channel": "email"}
    )
    prospect_id = prospect.json()["prospect"]["id"]
    async with session_factory() as session:
        campaign = Campaign(name="eBIHAR test")
        source = Source(name="Dossier email", type="email", platform="email")
        session.add_all([campaign, source])
        await session.flush()
        campaign_source = CampaignSource(campaign_id=campaign.id, source_id=source.id)
        session.add(campaign_source)
        await session.flush()
        membership = CampaignProspect(
            prospect_id=prospect_id, campaign_source_id=campaign_source.id
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
            "reason": "candidature_a_verifier",
            "summary": "Dossier reçu, campagne à confirmer",
            "recommended_action": "Vérifier le dossier",
        },
    )
    return prospect_id, membership_id, conversation_id


async def test_application_review_requires_confirmed_stage_and_removes_task(
    client, session_factory, mongo_db
):
    prospect_id, membership_id, conversation_id = await case(client, session_factory, mongo_db)
    path = f"{API}/conversations/{conversation_id}/resolve-application"
    pending = await client.post(path, json={"membership_id": membership_id})
    assert pending.status_code == 409
    async with session_factory() as session:
        membership = await session.get(CampaignProspect, membership_id)
        assert membership is not None
        membership.conversion_stage = ConversionStage.APPLIED
        await session.commit()

    reviewed = await client.post(path, json={"membership_id": membership_id})
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "open"
    assert reviewed.json()["handoff"] is None
    async with session_factory() as session:
        queue = await todo.list_todo(session, mongo_db, kind="application", limit=25, offset=0)
    assert queue.total == 0
    saved = await conversations.get_doc(mongo_db, conversation_id)
    assert saved["application_reviews"][0]["membership_id"] == membership_id
    assert saved["application_reviews"][0]["actor_user_id"] is not None
    assert saved["prospect_id"] == prospect_id
    assert (await client.post(path, json={"membership_id": membership_id})).status_code == 409


async def test_application_review_rejects_another_prospects_path(client, session_factory, mongo_db):
    _, membership_id, conversation_id = await case(client, session_factory, mongo_db)
    other = await client.post(
        f"{API}/prospects", json={"email": "other@demo.example.com", "channel": "email"}
    )
    other_id = other.json()["prospect"]["id"]
    async with session_factory() as session:
        membership = await session.get(CampaignProspect, membership_id)
        assert membership is not None
        membership.prospect_id = other_id
        membership.conversion_stage = ConversionStage.APPLIED
        await session.commit()
    response = await client.post(
        f"{API}/conversations/{conversation_id}/resolve-application",
        json={"membership_id": membership_id},
    )
    assert response.status_code == 409
    assert (await conversations.get_doc(mongo_db, conversation_id))["status"] == "handed_off"


async def test_viewer_cannot_resolve_application(client, make_client, session_factory, mongo_db):
    _, membership_id, conversation_id = await case(client, session_factory, mongo_db)
    viewer = await make_client(UserRole.VIEWER)
    response = await viewer.post(
        f"{API}/conversations/{conversation_id}/resolve-application",
        json={"membership_id": membership_id},
    )
    assert response.status_code == 403
