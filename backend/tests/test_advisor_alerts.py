"""Alertes du conseiller hors de la console : urgences tout de suite, le reste au récapitulatif
du matin (D-49)."""

from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.models import CampaignProspect, ScoreEvent
from app.models.enums import ScoreType, UserRole
from app.services import advisor_alerts, conversations, scoring
from sqlalchemy import update

from .test_agent_workflow import API, lead

# Mercredi 3 mars 2027 à Paris : 7 h 30 (avant le récapitulatif) et 8 h 30 (après).
BEFORE_DIGEST = datetime(2027, 3, 3, 6, 30, tzinfo=UTC)
AFTER_DIGEST = datetime(2027, 3, 3, 7, 30, tzinfo=UTC)
EVENT_AT = datetime(2027, 3, 3, 6, 0, tzinfo=UTC)
SETTINGS = Settings(
    _env_file=None,
    follow_up_worker_enabled=False,
    email_send_enabled=True,
    console_url="https://console.datum.test/",
)


class Mailbox:
    def __init__(self) -> None:
        self.sent: list = []

    async def send(self, email):
        self.sent.append(email)
        return f"<{len(self.sent)}@test>"


async def start(mongo_db):
    """Alertes activées la veille : les événements de test sont postérieurs."""
    await mongo_db[advisor_alerts.STATE].insert_one(
        {"_id": "started", "at": EVENT_AT - timedelta(1)}
    )


async def advisor_for(make_client, session_factory, mid):
    """Conseiller connecté, affecté au rattachement `mid`."""
    advisor = await make_client(UserRole.ADVISOR)
    me = (await advisor.get(f"{API}/auth/me")).json()
    async with session_factory() as s:
        await s.execute(
            update(CampaignProspect)
            .where(CampaignProspect.id == mid)
            .values(assigned_advisor_id=me["id"])
        )
        await s.commit()
    return advisor, me


async def hand_off(mongo_db, cid, reason):
    await conversations.set_handoff(mongo_db, cid, {"reason": reason, "summary": "Résumé privé"})
    await mongo_db["conversations"].update_one(
        {"handoff.reason": reason}, {"$set": {"handoff.created_at": EVENT_AT}}
    )


async def raise_score(session_factory, mid, points, *, actor=None):
    async with session_factory() as s:
        await scoring.apply_score(s, mid, ScoreType.INTEREST, points, "test", actor_user_id=actor)
        await s.execute(update(ScoreEvent).values(created_at=EVENT_AT))
        await s.commit()


async def run(session_factory, mongo_db, mailbox, now, settings=SETTINGS):
    return await advisor_alerts.run_alerts(
        session_factory, mongo_db, mailbox, settings=settings, now=now
    )


async def test_a_sensitive_handoff_is_emailed_at_once_to_the_assigned_advisor(
    client, make_client, session_factory, mongo_db
):
    await start(mongo_db)
    pid, mid, cid = await lead(client, last_name="Dupont")
    _, me = await advisor_for(make_client, session_factory, mid)
    await hand_off(mongo_db, cid, "situation_sensible")
    mailbox = Mailbox()

    summary = await run(session_factory, mongo_db, mailbox, BEFORE_DIGEST)
    assert summary.detected == 1 and summary.sent == 1
    [email] = mailbox.sent
    assert email.to_address == me["email"]
    assert email.subject == "[DATUM] Urgent : Situation sensible"
    assert "Jean D." in email.text and "Dupont" not in email.text
    assert "Recrutement eBIHAR" in email.text
    assert f"https://console.datum.test/prospects/{pid}" in email.text
    assert "Résumé privé" not in email.text and "Bonjour" not in email.text.split("\n", 1)[1]
    # Une seule fois, et pas de nouveau dans le récapitulatif.
    await run(session_factory, mongo_db, mailbox, AFTER_DIGEST)
    assert len(mailbox.sent) == 1


async def test_ordinary_handoffs_and_hot_prospects_wait_for_the_morning_digest(
    client, make_client, session_factory, mongo_db
):
    await start(mongo_db)
    _, mid, cid = await lead(client)
    _, me = await advisor_for(make_client, session_factory, mid)
    await hand_off(mongo_db, cid, "question_hors_base")
    await raise_score(session_factory, mid, 90)  # total 54 : chaud
    mailbox = Mailbox()

    summary = await run(session_factory, mongo_db, mailbox, BEFORE_DIGEST)
    assert summary.detected == 2 and mailbox.sent == []
    summary = await run(session_factory, mongo_db, mailbox, AFTER_DIGEST)
    assert summary.digest
    [digest] = mailbox.sent
    assert digest.to_address == me["email"]
    assert digest.subject == "[DATUM] Récapitulatif : 2 points à traiter"
    assert "Transfert : Question hors base de connaissances" in digest.text
    assert "Prospect devenu chaud" in digest.text
    assert "https://console.datum.test/todo" in digest.text
    # Un récapitulatif par jour.
    await run(session_factory, mongo_db, mailbox, AFTER_DIGEST + timedelta(hours=3))
    assert len(mailbox.sent) == 1


async def test_a_very_hot_prospect_is_urgent_unless_the_advisor_raised_the_score(
    client, make_client, session_factory, mongo_db
):
    await start(mongo_db)
    _, mid, _ = await lead(client)
    _, me = await advisor_for(make_client, session_factory, mid)
    await raise_score(session_factory, mid, 100, actor=me["id"])
    async with session_factory() as s:
        membership = await s.get(CampaignProspect, mid)
        assert membership.total_score >= 50
    _, mid2, _ = await lead(client, email="paul@example.com", first_name="Paul", phone="0698765432")
    await advisor_for_existing(session_factory, mid2, me["id"])
    async with session_factory() as s:
        await scoring.apply_score(s, mid2, ScoreType.FIT, 100, "profil")
        await scoring.apply_score(s, mid2, ScoreType.INTEREST, 100, "rendez-vous")
        await s.execute(update(ScoreEvent).values(created_at=EVENT_AT))
        await s.commit()
    mailbox = Mailbox()

    await run(session_factory, mongo_db, mailbox, BEFORE_DIGEST)
    [email] = mailbox.sent
    assert email.subject == "[DATUM] Prospect très chaud : Paul"
    # Le conseiller qui a lui-même relevé le score de Jean n'en reçoit rien, même le matin.
    await run(session_factory, mongo_db, mailbox, AFTER_DIGEST)
    assert all("Jean" not in e.text for e in mailbox.sent)


async def advisor_for_existing(session_factory, mid, advisor_id):
    async with session_factory() as s:
        await s.execute(
            update(CampaignProspect)
            .where(CampaignProspect.id == mid)
            .values(assigned_advisor_id=advisor_id)
        )
        await s.commit()


async def test_an_advisor_can_turn_alerts_off(client, make_client, session_factory, mongo_db):
    await start(mongo_db)
    _, mid, cid = await lead(client)
    advisor, _ = await advisor_for(make_client, session_factory, mid)
    assert (await advisor.get(f"{API}/auth/me/alerts")).json() == {"enabled": True}
    r = await advisor.put(f"{API}/auth/me/alerts", json={"enabled": False})
    assert r.status_code == 200 and r.json() == {"enabled": False}
    await hand_off(mongo_db, cid, "donnees_personnelles")
    mailbox = Mailbox()
    await run(session_factory, mongo_db, mailbox, AFTER_DIGEST)
    assert mailbox.sent == []


async def test_without_advisor_the_admins_are_told(client, session_factory, mongo_db):
    await start(mongo_db)
    _, _, cid = await lead(client)
    await hand_off(mongo_db, cid, "situation_sensible")
    mailbox = Mailbox()
    await run(session_factory, mongo_db, mailbox, BEFORE_DIGEST)
    assert [e.to_address for e in mailbox.sent] == ["admin@example.com"]


async def test_alerts_wait_while_sending_is_off_and_a_resolved_handoff_is_dropped(
    client, make_client, session_factory, mongo_db
):
    await start(mongo_db)
    _, mid, cid = await lead(client)
    await advisor_for(make_client, session_factory, mid)
    await hand_off(mongo_db, cid, "demande_conseiller")
    mailbox = Mailbox()
    off = SETTINGS.model_copy(update={"email_send_enabled": False})
    summary = await run(session_factory, mongo_db, mailbox, AFTER_DIGEST, off)
    assert summary.paused == "envoi des emails désactivé" and summary.detected == 1
    # Le conseiller a repris la conversation avant le récapitulatif : plus rien à signaler.
    await mongo_db["conversations"].update_one({}, {"$set": {"status": "open"}})
    await run(session_factory, mongo_db, mailbox, AFTER_DIGEST)
    assert mailbox.sent == []


async def test_nothing_before_activation_and_nothing_when_disabled(
    client, session_factory, mongo_db
):
    _, _, cid = await lead(client)
    await hand_off(mongo_db, cid, "situation_sensible")  # avant la première activation
    mailbox = Mailbox()
    disabled = SETTINGS.model_copy(update={"advisor_alerts_enabled": False})
    assert (await run(session_factory, mongo_db, mailbox, BEFORE_DIGEST, disabled)).paused
    summary = await run(session_factory, mongo_db, mailbox, BEFORE_DIGEST)
    assert summary.detected == 0 and mailbox.sent == []


async def test_a_demo_prospect_never_triggers_an_alert(client, session_factory, mongo_db):
    await start(mongo_db)
    _, _, cid = await lead(client, email="camille@demo.example.com")
    await hand_off(mongo_db, cid, "situation_sensible")
    mailbox = Mailbox()
    assert (await run(session_factory, mongo_db, mailbox, BEFORE_DIGEST)).detected == 0
