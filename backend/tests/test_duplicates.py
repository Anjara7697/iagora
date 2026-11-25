"""Doublons de prospects : file à trancher et fusion manuelle (jamais automatique)."""

from datetime import UTC, datetime, timedelta

from app.models import (
    Appointment,
    ConsentEvent,
    DuplicateCandidate,
    FollowUp,
    Interaction,
    Prospect,
)
from app.models.enums import (
    AppointmentStatus,
    ConsentStatus,
    DuplicateStatus,
    FollowUpStatus,
    UserRole,
)
from sqlalchemy import func, select

from .scope_helpers import entrust
from .test_demo import API, conversation_for

EMAIL = "marie@acme-corp.com"
PHONE = "+33612345678"
SOON = datetime.now(UTC) + timedelta(days=3)


async def ingest(client, **fields):
    r = await client.post(f"{API}/prospects", json=fields)
    assert r.status_code in (200, 201), r.text
    return r.json()


async def two_sheets(client):
    """Une fiche connue par son email, une autre par son téléphone, puis un lead qui porte les
    deux : c'est le cas qui créait jusqu'ici un doublon silencieux."""
    by_email = (await ingest(client, first_name="Marie", email=EMAIL))["prospect"]["id"]
    by_phone = (await ingest(client, last_name="Durand", phone=PHONE))["prospect"]["id"]
    both = await ingest(client, email=EMAIL, phone=PHONE, message="Bonjour")
    assert both["created"] is False and both["prospect"]["id"] == by_email
    return by_email, by_phone


async def pending(client, **params):
    r = await client.get(f"{API}/duplicates", params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def test_a_lead_linking_two_sheets_is_queued_not_merged(client, session_factory):
    by_email, by_phone = await two_sheets(client)

    page = await pending(client)
    assert page["total"] == 1
    pair = page["items"][0]
    assert {pair["prospect_id"], pair["other_prospect_id"]} == {by_email, by_phone}
    assert pair["matched_fields"] == ["email", "phone"]
    assert [p["id"] for p in pair["prospects"]] == [by_email, by_phone]
    # Rien n'est fusionné tant que personne n'a tranché.
    assert (await client.get(f"{API}/prospects/{by_phone}")).status_code == 200

    # Un rejeu (même lead reçu deux fois) ne crée pas de deuxième signalement.
    await ingest(client, email=EMAIL, phone=PHONE)
    assert (await pending(client))["total"] == 1
    assert (await pending(client, prospect_id=by_phone))["total"] == 1
    other = (await ingest(client, email="autre@acme-corp.com"))["prospect"]["id"]
    assert (await pending(client, prospect_id=other))["total"] == 0


async def test_merge_moves_identifiers_history_and_conversations(client, session_factory, mongo_db):
    by_email, by_phone = await two_sheets(client)
    await conversation_for(client, by_phone)  # conversation email active sur la fiche absorbée
    await mongo_db["agent_runs"].insert_one({"prospect_id": by_phone, "action": "reply"})
    async with session_factory() as s:
        s.add(
            Appointment(
                prospect_id=by_phone,
                start_at=SOON,
                end_at=SOON + timedelta(minutes=30),
                status=AppointmentStatus.SCHEDULED,
            )
        )
        s.add(FollowUp(prospect_id=by_phone, scheduled_at=SOON))
        await s.commit()
    pair = (await pending(client))["items"][0]

    r = await client.post(
        f"{API}/duplicates/{pair['id']}/merge", json={"keep_prospect_id": by_email}
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "merged" and r.json()["kept_prospect_id"] == by_email

    kept = (await client.get(f"{API}/prospects/{by_email}")).json()
    assert kept["email"] == EMAIL and kept["phone"] == PHONE
    assert kept["first_name"] == "Marie" and kept["last_name"] == "Durand"
    assert (await client.get(f"{API}/prospects/{by_phone}")).status_code == 404
    assert (await client.get(f"{API}/prospects/{by_email}/conversation")).status_code == 200
    for name in ("conversations", "agent_runs"):
        assert await mongo_db[name].count_documents({"prospect_id": by_phone}) == 0
    assert await mongo_db["agent_runs"].count_documents({"prospect_id": by_email}) == 1
    async with session_factory() as s:
        for model in (Appointment, FollowUp, Interaction):
            n = await s.scalar(
                select(func.count()).select_from(model).where(model.prospect_id == by_email)
            )
            assert n >= 1, model
        trace = await s.scalar(
            select(Interaction).where(
                Interaction.prospect_id == by_email, Interaction.type == "prospects_merged"
            )
        )
        assert trace is not None and str(by_phone) in (trace.intent or "")
    assert (await pending(client))["total"] == 0

    # Un nouveau lead avec le seul téléphone retrouve la fiche fusionnée.
    again = await ingest(client, phone=PHONE)
    assert again["created"] is False and again["prospect"]["id"] == by_email

    # Rejouer la même décision ne change rien ; une autre décision est refusée.
    url = f"{API}/duplicates/{pair['id']}"
    replay = await client.post(f"{url}/merge", json={"keep_prospect_id": by_email})
    assert replay.status_code == 200
    assert (
        await client.post(f"{url}/merge", json={"keep_prospect_id": by_phone})
    ).status_code == 409
    assert (await client.post(f"{url}/distinct")).status_code == 409


async def test_an_opt_out_on_either_sheet_survives_the_merge(client, session_factory):
    by_email, by_phone = await two_sheets(client)
    r = await client.post(f"{API}/prospects/{by_phone}/opt-out", json={})
    assert r.status_code == 200, r.text
    async with session_factory() as s:
        s.add(FollowUp(prospect_id=by_email, scheduled_at=SOON))
        await s.commit()
    pair = (await pending(client))["items"][0]

    r = await client.post(
        f"{API}/duplicates/{pair['id']}/merge", json={"keep_prospect_id": by_email}
    )
    assert r.status_code == 200, r.text
    async with session_factory() as s:
        kept = await s.get(Prospect, by_email)
        assert kept is not None and kept.consent_status is ConsentStatus.OPTED_OUT
        statuses = set(
            await s.scalars(select(FollowUp.status).where(FollowUp.prospect_id == by_email))
        )
        assert statuses == {FollowUpStatus.CANCELLED}
        # L'historique du consentement de la fiche absorbée est gardé.
        events = await s.scalar(
            select(func.count())
            .select_from(ConsentEvent)
            .where(ConsentEvent.prospect_id == by_email)
        )
        assert events >= 1


async def test_two_active_conversations_on_the_same_channel_block_the_merge(client):
    by_email, by_phone = await two_sheets(client)
    await conversation_for(client, by_email)
    await conversation_for(client, by_phone)
    pair = (await pending(client))["items"][0]
    r = await client.post(
        f"{API}/duplicates/{pair['id']}/merge", json={"keep_prospect_id": by_email}
    )
    assert r.status_code == 409 and "clôturez" in r.json()["detail"]
    assert (await client.get(f"{API}/prospects/{by_phone}")).status_code == 200
    assert (await pending(client))["total"] == 1


async def test_keep_must_be_one_of_the_pair(client):
    await two_sheets(client)
    other = (await ingest(client, email="autre@acme-corp.com"))["prospect"]["id"]
    pair = (await pending(client))["items"][0]
    r = await client.post(f"{API}/duplicates/{pair['id']}/merge", json={"keep_prospect_id": other})
    assert r.status_code == 422
    assert (await client.post(f"{API}/duplicates/999/distinct")).status_code == 404


async def test_distinct_people_leave_the_queue_for_good(client, session_factory):
    by_email, by_phone = await two_sheets(client)
    pair = (await pending(client))["items"][0]
    r = await client.post(f"{API}/duplicates/{pair['id']}/distinct")
    assert r.status_code == 200 and r.json()["status"] == "distinct"
    await ingest(client, email=EMAIL, phone=PHONE)
    assert (await pending(client))["total"] == 0
    for pid in (by_email, by_phone):
        assert (await client.get(f"{API}/prospects/{pid}")).status_code == 200


async def test_merging_reroutes_other_pending_pairs(client, session_factory):
    by_email, by_phone = await two_sheets(client)
    linkedin = (await ingest(client, linkedin_id="li-marie"))["prospect"]["id"]
    # Un lead relie aussi la fiche « téléphone » à une troisième fiche (LinkedIn).
    await ingest(client, phone=PHONE, linkedin_id="li-marie")
    assert (await pending(client))["total"] == 2
    first = next(p for p in (await pending(client))["items"] if by_email in (p["prospect_id"],))
    r = await client.post(
        f"{API}/duplicates/{first['id']}/merge", json={"keep_prospect_id": by_email}
    )
    assert r.status_code == 200, r.text
    left = (await pending(client))["items"]
    assert len(left) == 1
    assert {left[0]["prospect_id"], left[0]["other_prospect_id"]} == {by_email, linkedin}


async def test_erasing_a_sheet_drops_its_pending_pairs(client, session_factory):
    by_email, by_phone = await two_sheets(client)
    r = await client.post(
        f"{API}/prospects/{by_phone}/erase", json={"reason": "request", "confirm": str(by_phone)}
    )
    assert r.status_code == 200, r.text
    assert (await pending(client))["total"] == 0
    async with session_factory() as s:
        left = await s.scalar(
            select(func.count())
            .select_from(DuplicateCandidate)
            .where(DuplicateCandidate.status == DuplicateStatus.PENDING)
        )
        assert left == 0


async def test_advisors_only_see_and_merge_pairs_of_their_scope(client, make_client):
    by_email, by_phone = await two_sheets(client)
    alice = await make_client(UserRole.ADVISOR)
    viewer = await make_client(UserRole.VIEWER)
    assert (await pending(alice))["total"] == 0  # aucune des deux fiches dans son périmètre
    pair = (await pending(client))["items"][0]
    url = f"{API}/duplicates/{pair['id']}/merge"
    body = {"keep_prospect_id": by_email}
    assert (await alice.post(url, json=body)).status_code == 404

    await entrust(client, alice, by_email)
    assert (await pending(alice))["total"] == 0  # une seule des deux fiches visible
    await entrust(client, alice, by_phone)
    assert (await pending(alice))["total"] == 1
    assert (await viewer.post(url, json=body)).status_code == 403
    assert (await alice.post(url, json=body)).status_code == 200
