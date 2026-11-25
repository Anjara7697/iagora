"""Alertes du conseiller hors de la console (décision D-49) : escalades et prospects chauds.

Deux rythmes, choisis par le responsable du projet :
- **immédiat** pour les urgences : situation sensible, demande sur les données personnelles,
  prospect très chaud (transféré ou qui vient de le devenir) ;
- **récapitulatif** le matin (jours ouvrés, heure des Paramètres, fuseau de l'agenda) pour le reste
  : autres transferts et prospects devenus chauds, encore d'actualité.

Les alertes sont repérées dans les données (transferts des conversations, variations du score
total qui franchissent un seuil), pas au fil de l'eau : aucun parcours de l'agent ne dépend d'elles
et un serveur email en panne ne bloque rien. Chaque alerte est enregistrée une seule fois dans
MongoDB (`advisor_alerts`, identifiant unique) ; rien d'antérieur à la première activation n'est
envoyé.

Destinataires : le conseiller affecté au prospect, à défaut le responsable de la campagne, à défaut
les administrateurs. Chacun peut couper ses alertes dans Mon compte (`advisor_alert_prefs`). Le
conseiller qui a lui-même modifié le score n'est pas prévenu de son geste.

Contenu : un texte écrit par le code (motif, prénom et initiale, campagne, niveau, lien vers la
console). Jamais le message du prospect ni le résumé du modèle : l'email sort de la console.
Les prospects fictifs (`@demo.example.com`) ne déclenchent rien. Le bac à sable de l'email
s'applique aussi aux conseillers.
"""

import logging
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.integrations.email.base import EmailClient, EmailError, OutboundEmail
from app.models import Campaign, CampaignProspect, CampaignSource, Prospect, ScoreEvent, User
from app.models.enums import ConversationStatus, InterestLevel, ScoreType, UserRole
from app.services import scoring

logger = logging.getLogger(__name__)

COLLECTION = "advisor_alerts"
STATE = "advisor_alerts_state"
PREFS = "advisor_alert_prefs"
LOOKBACK = timedelta(days=2)  # fenêtre de repérage : la boucle passe toutes les 5 minutes
EXPIRY = timedelta(days=3)  # une alerte jamais partie (email coupé) n'est plus envoyée
URGENT_REASONS = {"situation_sensible", "donnees_personnelles"}
HOT = {InterestLevel.HOT, InterestLevel.VERY_HOT}
DEMO_DOMAIN = "@demo.example.com"

SessionFactory = Callable[[], AsyncSession]

REASONS = {
    "inscription_a_verifier": "Inscription à confirmer",
    "candidature_a_verifier": "Candidature à vérifier",
    "question_hors_base": "Question hors base de connaissances",
    "situation_sensible": "Situation sensible",
    "donnees_personnelles": "Demande sur ses données personnelles (RGPD)",
    "demande_conseiller": "Le prospect demande un conseiller",
    "llm_indisponible": "Modèle de langage indisponible",
    "reponse_non_verifiable": "Réponse non vérifiable",
    "agenda_indisponible": "Agenda indisponible",
    "agenda_non_configure": "Rendez-vous à planifier (agenda non branché)",
    "aucun_creneau": "Aucun créneau disponible",
    "reservation_impossible": "Réservation impossible",
    "incertitude": "Incertitude du modèle",
    "consentement_meta_a_confirmer": "Consentement à confirmer (lead Meta)",
}
LEVELS = {"hot": "chaud", "very_hot": "très chaud", "warm": "tiède", "cold": "froid"}


@dataclass
class AlertSummary:
    detected: int = 0
    sent: int = 0  # emails envoyés (un par destinataire)
    digest: bool = False  # le récapitulatif du jour vient de partir
    paused: str | None = None
    notes: list[str] = field(default_factory=list)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


# --- Préférences ---------------------------------------------------------------------------


async def is_enabled_for(db: Any, user_id: int) -> bool:
    doc = await db[PREFS].find_one({"_id": user_id})
    return bool(doc.get("enabled", True)) if doc else True


async def set_enabled_for(db: Any, user_id: int, enabled: bool) -> None:
    await db[PREFS].update_one(
        {"_id": user_id},
        {"$set": {"enabled": enabled, "updated_at": datetime.now(UTC)}},
        upsert=True,
    )


# --- Repérage -----------------------------------------------------------------------------


async def _started_at(db: Any, now: datetime) -> datetime:
    """Date de la première activation : rien d'antérieur n'est envoyé (pas de rattrapage)."""
    try:
        await db[STATE].insert_one({"_id": "started", "at": now})
        return now
    except DuplicateKeyError:
        doc = await db[STATE].find_one({"_id": "started"})
        return _aware(doc["at"]) if doc else now


async def _insert(db: Any, key: str, **fields: Any) -> bool:
    try:
        await db[COLLECTION].insert_one({"_id": key, "status": "pending", "sent_to": [], **fields})
        return True
    except DuplicateKeyError:
        return False


async def _levels(session: AsyncSession, prospect_id: int) -> set[str]:
    rows = await session.scalars(
        select(CampaignProspect.interest_status).where(CampaignProspect.prospect_id == prospect_id)
    )
    return {r.value for r in rows if r is not None}


async def _is_demo(session: AsyncSession, prospect_id: int) -> bool:
    email = await session.scalar(select(Prospect.email).where(Prospect.id == prospect_id))
    return bool(email and email.lower().endswith(DEMO_DOMAIN))


async def detect(session: AsyncSession, db: Any, *, now: datetime) -> int:
    """Enregistre les nouvelles alertes ; retourne leur nombre."""
    since = max(await _started_at(db, now), now - LOOKBACK)
    found = 0
    # Transferts à un conseiller (escalades, incidents, lacunes, inscriptions…).
    cursor = db["conversations"].find(
        {"handoff.created_at": {"$gte": since}, "simulation": {"$ne": True}},
        {"prospect_id": 1, "handoff.reason": 1, "handoff.created_at": 1},
    )
    async for doc in cursor:
        pid = int(doc["prospect_id"])
        if await _is_demo(session, pid):
            continue
        handoff = doc["handoff"]
        at = _aware(handoff["created_at"])
        reason = handoff.get("reason")
        levels = await _levels(session, pid)
        urgent = reason in URGENT_REASONS or InterestLevel.VERY_HOT.value in levels
        key = f"handoff:{doc['_id']}:{at.isoformat()}"
        found += await _insert(
            db, key, kind="handoff", urgent=urgent, prospect_id=pid,
            conversation_id=str(doc["_id"]), reason=reason, at=at, created_at=now,
        )  # fmt: skip
    # Prospects qui franchissent le seuil « chaud » ou « très chaud » (score total).
    events = await session.scalars(
        select(ScoreEvent).where(
            ScoreEvent.score_type == ScoreType.TOTAL,
            ScoreEvent.created_at >= since,
            ScoreEvent.points > 0,
            ScoreEvent.campaign_prospect_id.is_not(None),
        )
    )
    for event in events:
        after = scoring.level_for(event.new_value)
        before = scoring.level_for(event.new_value - event.points)
        if after not in HOT or after == before:
            continue
        if await _is_demo(session, event.prospect_id):
            continue
        # Une fois par niveau atteint et par rattachement : pas de rafale si le score oscille.
        key = f"hot:{event.campaign_prospect_id}:{after.value}"
        found += await _insert(
            db, key, kind="hot", urgent=after is InterestLevel.VERY_HOT,
            prospect_id=event.prospect_id, membership_id=event.campaign_prospect_id,
            level=after.value, actor_user_id=event.actor_user_id,
            at=_aware(event.created_at), created_at=now,
        )  # fmt: skip
    return found


# --- Destinataires et contenu -------------------------------------------------------------


@dataclass(frozen=True)
class Context:
    first_name: str
    initial: str
    campaigns: list[str]
    level: str | None
    advisor_ids: set[int]


async def _context(session: AsyncSession, alert: dict[str, Any]) -> Context | None:
    prospect = await session.get(Prospect, int(alert["prospect_id"]))
    if prospect is None:
        return None
    query = (
        select(CampaignProspect, Campaign)
        .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
        .join(Campaign, Campaign.id == CampaignSource.campaign_id)
        .where(CampaignProspect.prospect_id == prospect.id)
    )
    if alert.get("membership_id") is not None:
        query = query.where(CampaignProspect.id == int(alert["membership_id"]))
    rows = (await session.execute(query)).all()
    advisors: set[int] = set()
    campaigns: list[str] = []
    levels: list[str] = []
    for membership, campaign in rows:
        advisor = membership.assigned_advisor_id or campaign.responsible_advisor_id
        if advisor is not None:
            advisors.add(advisor)
        campaigns.append(campaign.name)
        if membership.interest_status is not None:
            levels.append(membership.interest_status.value)
    order = ["very_hot", "hot", "warm", "cold"]
    level = next((lv for lv in order if lv in levels), None)
    return Context(
        first_name=prospect.first_name or "Prospect",
        initial=f"{prospect.last_name[0].upper()}." if prospect.last_name else "",
        campaigns=campaigns,
        level=level,
        advisor_ids=advisors,
    )


async def recipients(
    session: AsyncSession, db: Any, alert: dict[str, Any], context: Context, settings: Settings
) -> list[User]:
    """Conseillers concernés (à défaut, administrateurs), actifs, qui n'ont pas coupé leurs
    alertes ; jamais l'auteur d'un ajustement de score manuel."""
    if context.advisor_ids:
        users = await session.scalars(select(User).where(User.id.in_(context.advisor_ids)))
    else:
        users = await session.scalars(select(User).where(User.role == UserRole.ADMIN))
    sandbox = settings.email_sandbox_list
    chosen: list[User] = []
    for user in users:
        if not user.is_active or not user.email or user.id == alert.get("actor_user_id"):
            continue
        if sandbox and user.email.lower() not in sandbox:
            continue
        if await is_enabled_for(db, user.id):
            chosen.append(user)
    return sorted(chosen, key=lambda u: u.id)


def _who(context: Context) -> str:
    return f"{context.first_name} {context.initial}".strip()


def _link(settings: Settings, path: str) -> str | None:
    base = settings.console_url.rstrip("/")
    return f"{base}{path}" if base else None


def describe(alert: dict[str, Any], context: Context) -> str:
    """Une ligne : ce qui s'est passé, pour qui (prénom et initiale seulement)."""
    if alert["kind"] == "hot":
        what = f"Prospect devenu {LEVELS.get(alert['level'], alert['level'])}"
    else:
        reason = alert.get("reason")
        what = f"Transfert : {REASONS.get(reason or '', 'intervention d’un conseiller')}"
    details = [_who(context)]
    if context.campaigns:
        details.append(", ".join(sorted(set(context.campaigns))))
    if alert["kind"] == "handoff" and context.level:
        details.append(f"prospect {LEVELS.get(context.level, context.level)}")
    return f"{what} ({' · '.join(details)})"


def urgent_email(
    to: str, alert: dict[str, Any], context: Context, settings: Settings
) -> OutboundEmail:
    if alert["kind"] == "hot":
        subject = f"[DATUM] Prospect très chaud : {_who(context)}"
    else:
        subject = f"[DATUM] Urgent : {REASONS.get(alert.get('reason') or '', 'transfert')}"
    lines = [
        "Bonjour,",
        "",
        "Une situation demande votre attention dans la console DATUM :",
        f"- {describe(alert, context)}",
    ]
    link = _link(settings, f"/prospects/{alert['prospect_id']}")
    if link:
        lines.append(f"- Fiche du prospect : {link}")
    lines += ["", *_footer()]
    return OutboundEmail(to_address=to, subject=subject, text="\n".join(lines))


def digest_email(
    to: str, items: list[tuple[dict[str, Any], Context]], settings: Settings
) -> OutboundEmail:
    count = len(items)
    plural = "s" if count > 1 else ""
    lines = [
        "Bonjour,",
        "",
        f"{count} point{plural} à traiter dans la console DATUM :",
    ]
    for alert, context in items:
        lines.append(f"- {describe(alert, context)}")
        link = _link(settings, f"/prospects/{alert['prospect_id']}")
        if link:
            lines.append(f"  {link}")
    todo = _link(settings, "/todo")
    if todo:
        lines += ["", f"Tout ce qui attend un conseiller : {todo}"]
    lines += ["", *_footer()]
    subject = f"[DATUM] Récapitulatif : {count} point{plural} à traiter"
    return OutboundEmail(to_address=to, subject=subject, text="\n".join(lines))


def _footer() -> list[str]:
    return [
        "Message automatique de la console DATUM.",
        "Pour ne plus recevoir ces alertes : Mon compte, « Alertes par email ».",
    ]


# --- Envoi --------------------------------------------------------------------------------


async def _still_relevant(session: AsyncSession, db: Any, alert: dict[str, Any]) -> bool:
    """Un transfert déjà repris, ou un prospect redescendu, n'a plus sa place au récapitulatif."""
    if alert["kind"] == "handoff":
        doc = await db["conversations"].find_one(
            {"_id": ObjectId(alert["conversation_id"])}, {"status": 1, "handoff.created_at": 1}
        )
        if not doc or doc.get("status") != ConversationStatus.HANDED_OFF.value:
            return False
        return _aware(doc["handoff"]["created_at"]) == _aware(alert["at"])
    membership = await session.get(CampaignProspect, int(alert["membership_id"]))
    return membership is not None and membership.interest_status in HOT


async def _deliver(
    db: Any,
    client: EmailClient,
    alert: dict[str, Any],
    users: list[User],
    context: Context,
    settings: Settings,
) -> int:
    """Un email par destinataire ; chaque envoi est noté, un nouvel essai ne double rien."""
    sent = 0
    for user in users:
        if user.id in alert.get("sent_to", []):
            continue
        await client.send(urgent_email(user.email, alert, context, settings))
        await db[COLLECTION].update_one({"_id": alert["_id"]}, {"$addToSet": {"sent_to": user.id}})
        sent += 1
    return sent


async def _close(db: Any, key: str, status: str, now: datetime) -> None:
    await db[COLLECTION].update_one({"_id": key}, {"$set": {"status": status, "sent_at": now}})


def digest_due(now: datetime, settings: Settings) -> str | None:
    """Jour du récapitulatif (AAAA-MM-JJ) s'il doit partir maintenant : jour ouvré, à partir de
    l'heure des Paramètres (fuseau de l'agenda)."""
    local = now.astimezone(ZoneInfo(settings.calendar_timezone))
    if local.weekday() >= 5 or local.hour < settings.advisor_alerts_digest_hour:
        return None
    return local.date().isoformat()


async def run_alerts(
    session_factory: SessionFactory,
    db: Any,
    client: EmailClient | None,
    *,
    settings: Settings,
    now: datetime | None = None,
) -> AlertSummary:
    """Un passage : repère les nouvelles alertes, envoie les urgentes, puis le récapitulatif du
    jour s'il est l'heure. Sans email d'envoi configuré, les alertes attendent (3 jours au plus)."""
    now = now or datetime.now(UTC)
    summary = AlertSummary()
    if not settings.advisor_alerts_enabled:
        summary.paused = "alertes désactivées dans les Paramètres"
        return summary
    async with session_factory() as session:
        summary.detected = await detect(session, db, now=now)
        await db[COLLECTION].update_many(
            {"status": "pending", "created_at": {"$lt": now - EXPIRY}},
            {"$set": {"status": "expired"}},
        )
        if client is None or not settings.email_send_enabled:
            summary.paused = "envoi des emails désactivé"
            return summary
        try:
            await _send_urgent(session, db, client, settings, now, summary)
            await _send_digest(session, db, client, settings, now, summary)
        except EmailError as exc:
            # Les alertes restent en attente ; nouvel essai au prochain passage.
            logger.warning("Alertes des conseillers : envoi impossible (%s)", type(exc).__name__)
            summary.notes.append("serveur email indisponible")
    if summary.sent:
        logger.info("Alertes des conseillers : %d email(s) envoyé(s)", summary.sent)
    return summary


async def _send_urgent(
    session: AsyncSession,
    db: Any,
    client: EmailClient,
    settings: Settings,
    now: datetime,
    summary: AlertSummary,
) -> None:
    async for alert in db[COLLECTION].find({"status": "pending", "urgent": True}).sort("at", 1):
        context = await _context(session, alert)
        if context is None:
            await _close(db, alert["_id"], "skipped", now)
            continue
        users = await recipients(session, db, alert, context, settings)
        summary.sent += await _deliver(db, client, alert, users, context, settings)
        await _close(db, alert["_id"], "sent" if users else "no_recipient", now)


async def _send_digest(
    session: AsyncSession,
    db: Any,
    client: EmailClient,
    settings: Settings,
    now: datetime,
    summary: AlertSummary,
) -> None:
    day = digest_due(now, settings)
    if day is None:
        return
    done = await db[STATE].find_one({"_id": f"digest:{day}"})
    if done:
        return
    pending = [a async for a in db[COLLECTION].find({"status": "pending"}).sort("at", 1)]
    by_user: dict[int, list[tuple[dict[str, Any], Context]]] = defaultdict(list)
    emails: dict[int, str] = {}
    for alert in pending:
        context = await _context(session, alert)
        if context is None or not await _still_relevant(session, db, alert):
            await _close(db, alert["_id"], "outdated", now)
            continue
        for user in await recipients(session, db, alert, context, settings):
            by_user[user.id].append((alert, context))
            emails[user.id] = user.email
    sent_today = set(
        ((await db[STATE].find_one({"_id": f"digest-sent:{day}"})) or {}).get("to", [])
    )
    for user_id, items in sorted(by_user.items()):
        if user_id in sent_today:
            continue
        await client.send(digest_email(emails[user_id], items, settings))
        await db[STATE].update_one(
            {"_id": f"digest-sent:{day}"}, {"$addToSet": {"to": user_id}}, upsert=True
        )
        summary.sent += 1
    for alert in pending:
        await db[COLLECTION].update_one(
            {"_id": alert["_id"], "status": "pending"}, {"$set": {"status": "sent", "sent_at": now}}
        )
    await db[STATE].insert_one({"_id": f"digest:{day}", "at": now})
    summary.digest = True
