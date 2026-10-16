"""Synchronisation de la boîte email : messages reçus -> conversations, messages validés -> envoi.

Réception (`sync_inbound`) : chaque email non lu devient un message du prospect (le prospect est
créé s'il est inconnu). L'email n'est marqué « lu » qu'après traitement ; l'en-tête Message-ID
sert d'identifiant d'idempotence : relire un email ne crée jamais de doublon.

Envoi (`deliver_outbox`) : les messages `delivery: not_sent` d'une conversation email (validés
par un conseiller, ou réponses directes en mode automatique) sont envoyés un par un. Chaque
message est « réclamé » de façon atomique (`sending`) avant l'envoi : deux processus ne
l'envoient jamais deux fois. Garde-fous : envoi désactivé par défaut, bac à sable de
destinataires, jamais vers un prospect désinscrit (S-03), trois essais au plus.

Cycle de vie de `metadata.delivery` : not_sent -> sending -> sent | failed | blocked.
"""

import hashlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pymongo import ReturnDocument
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.graph import policy
from app.integrations.email.base import EmailClient, EmailError, InboundEmail, OutboundEmail
from app.models.enums import ConsentStatus, SenderType
from app.schemas.conversation import ConversationCreate, MessageCreate
from app.schemas.prospect import ProspectIngest
from app.services import agent_events, agent_settings, conversations
from app.services.agent_settings import AgentMode
from app.services.prospects import find_existing, get_prospect, ingest_prospect

logger = logging.getLogger(__name__)

CHANNEL = "email"
STATE_ID = "email_sync"
MAX_ATTEMPTS = 3
OUTBOX_BATCH = 20
DEFAULT_SUBJECT = "DATUM Academy"
DEMO_DOMAINS = ("@demo.example.com", "@example.com", "@example.org", "@example.net")

SessionFactory = Callable[[], AsyncSession]
OnMessage = Callable[[str], Awaitable[None]]  # reçoit l'identifiant de la conversation


@dataclass
class SyncReport:
    received: int = 0
    duplicates: int = 0
    skipped: int = 0
    errors: int = 0
    sent: int = 0
    blocked: int = 0
    failed: int = 0
    retried: int = 0
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if k != "notes"} | {"notes": self.notes[:20]}


def _now() -> datetime:
    return datetime.now(UTC)


def _split_name(display: str, address: str) -> tuple[str | None, str | None]:
    name = display.strip() or address.split("@")[0].replace(".", " ").replace("_", " ").strip()
    first, _, last = name.partition(" ")
    return (first.title()[:100] or None), (last.strip().title()[:100] or None)


# --- Réception ---


async def _count_failure(db: Any, message_id: str) -> int:
    key = "failures." + hashlib.sha256(message_id.encode()).hexdigest()[:24]
    doc = await db[agent_settings.COLLECTION].find_one_and_update(
        {"_id": STATE_ID},
        {"$inc": {key: 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    counts = (doc or {}).get("failures", {})
    return int(counts.get(key.split(".", 1)[1], 0))


async def _ingest_email(
    session_factory: SessionFactory,
    db: Any,
    mail: InboundEmail,
    settings: Settings,
    report: SyncReport,
) -> str | None:
    """Enregistre un email reçu. Retourne l'identifiant de conversation à traiter par l'agent,
    ou None (doublon, expéditeur ignoré, message suspect)."""
    async with session_factory() as session:
        first, last = _split_name(mail.from_name, mail.from_address)
        ingest = ProspectIngest(
            first_name=first,
            last_name=last,
            email=mail.from_address,
            channel=CHANNEL,
            consent_granted=True,  # le prospect nous écrit de lui-même
            consent_source="email_inbound",
        )
        if (
            not settings.email_create_unknown_senders
            and await find_existing(session, ingest) is None
        ):
            report.skipped += 1
            report.notes.append("expéditeur inconnu ignoré")
            return None
        prospect, _, _ = await ingest_prospect(session, ingest)
        conversation, created = await conversations.create_conversation(
            session, db, ConversationCreate(prospect_id=prospect.id, channel=CHANNEL)
        )
        content = mail.text.strip() or mail.subject.strip() or "(message vide)"
        if created and mail.subject.strip():
            content = f"{mail.subject.strip()}\n\n{content}"[:20_000]
        message, is_new = await conversations.add_message(
            session,
            db,
            conversation.id,
            MessageCreate(
                role=SenderType.PROSPECT,
                content=content,
                external_message_id=mail.message_id[:255],
                metadata={
                    "email": {
                        "subject": mail.subject[:300],
                        "in_reply_to": mail.in_reply_to,
                        "references": mail.references[-20:],
                        "suspect": mail.suspect,
                    }
                },
            ),
        )
        if (
            settings.agent_auto_reply
            and not mail.suspect
            and not policy.is_opt_out(message.content)
        ):
            await agent_events.enqueue_reply(db, conversation.id)
        if not is_new:
            report.duplicates += 1
            return None
        report.received += 1
        if policy.is_opt_out(message.content):
            report.notes.append(f"désinscription reçue par email : prospect {prospect.id}")
            return None
        if mail.suspect:
            report.notes.append(f"message suspect (authentification en échec) : {message.id}")
            return None  # visible dans la conversation, mais l'agent ne répond pas
        return conversation.id


async def sync_inbound(
    session_factory: SessionFactory,
    db: Any,
    client: EmailClient,
    settings: Settings,
    on_message: OnMessage | None = None,
) -> SyncReport:
    report = SyncReport()
    for mail in await client.fetch_unseen():
        try:
            conversation_id: str | None = None
            if mail.is_automatic or mail.from_address == settings.email_sender_address:
                report.skipped += 1  # réponse automatique, rebond, ou notre propre message
            else:
                conversation_id = await _ingest_email(session_factory, db, mail, settings, report)
            await client.mark_seen(mail.uid)
        except Exception:
            logger.exception("Email %s non traité", mail.uid)
            report.errors += 1
            if await _count_failure(db, mail.message_id) >= MAX_ATTEMPTS:
                # Email « poison » : après plusieurs échecs on le met de côté pour ne pas boucler.
                report.notes.append(f"email {mail.uid} abandonné après {MAX_ATTEMPTS} échecs")
                await client.mark_seen(mail.uid)
            continue
        if conversation_id and on_message is not None:
            try:
                await on_message(conversation_id)
            except (
                Exception
            ):  # l'email est enregistré : une panne de l'agent ne bloque pas la suite
                logger.exception("Réponse automatique en erreur (conversation %s)", conversation_id)
                report.errors += 1
    return report


# --- Envoi -------------------------------------------------------------------------------------


def _outbound_candidates(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        m
        for m in doc.get("messages", [])
        if (m.get("metadata") or {}).get("delivery") == "not_sent"
        and m.get("role") in (SenderType.AGENT.value, SenderType.ADVISOR.value)
    ]


async def _claim(db: Any, conversation_id: Any, message_id: str) -> bool:
    result = await db[conversations.COLLECTION].update_one(
        {
            "_id": conversation_id,
            "messages": {
                "$elemMatch": {"id": message_id, "metadata.delivery": "not_sent"},
            },
        },
        {"$set": {"messages.$.metadata.delivery": "sending"}},
    )
    return bool(result.modified_count == 1)


async def _finish(
    db: Any, conversation_id: Any, message: dict[str, Any], delivery: str, **info: Any
) -> None:
    """Écrit l'issue de l'envoi (une seule mise à jour : on remplace `metadata`)."""
    metadata = dict(message.get("metadata") or {})
    previous = dict(metadata.get("delivery_info") or {})
    metadata["delivery"] = delivery
    metadata["delivery_info"] = previous | info
    await db[conversations.COLLECTION].update_one(
        {
            "_id": conversation_id,
            "messages": {"$elemMatch": {"id": message["id"], "metadata.delivery": "sending"}},
        },
        {"$set": {"messages.$.metadata": metadata}},
    )


def _thread_headers(
    doc: dict[str, Any], message: dict[str, Any]
) -> tuple[str, str | None, list[str]]:
    """Objet « Re: … » et en-têtes de fil, d'après le dernier email du prospect avant ce message."""
    previous = [
        m
        for m in doc.get("messages", [])
        if m.get("role") == SenderType.PROSPECT.value
        and m.get("created_at") is not None
        and m["created_at"] <= message["created_at"]
    ]
    if not previous:
        return DEFAULT_SUBJECT, None, []
    last = max(previous, key=lambda m: m["created_at"])
    info = (last.get("metadata") or {}).get("email") or {}
    subject = (info.get("subject") or "").strip() or DEFAULT_SUBJECT
    if not subject.lower().startswith(("re:", "réf:")):
        subject = f"Re: {subject}"
    in_reply_to = last.get("external_message_id")
    references = [*info.get("references", []), *([in_reply_to] if in_reply_to else [])]
    return subject[:300], in_reply_to, references[-20:]


def _with_footer(text: str, settings: Settings) -> str:
    footer = settings.email_footer.strip()
    return f"{text.rstrip()}\n\n-- \n{footer}" if footer else text


@dataclass
class _SendAttempt:
    smtp_started: bool = False


async def _deliver_one(
    session_factory: SessionFactory,
    db: Any,
    client: EmailClient,
    settings: Settings,
    doc: dict[str, Any],
    message: dict[str, Any],
    report: SyncReport,
) -> None:
    conv_id = doc["_id"]
    if not await _claim(db, conv_id, message["id"]):
        return  # pris par un autre processus ou annulé
    attempt = _SendAttempt()
    try:
        await _deliver_claimed(session_factory, db, client, settings, doc, message, report, attempt)
    except Exception:
        if not attempt.smtp_started:
            # Panne pendant les contrôles : aucun risque de renvoyer un email déjà transmis.
            await db[conversations.COLLECTION].update_one(
                {
                    "_id": conv_id,
                    "messages": {
                        "$elemMatch": {"id": message["id"], "metadata.delivery": "sending"}
                    },
                },
                {"$set": {"messages.$.metadata.delivery": "not_sent"}},
            )
        raise


async def _deliver_claimed(
    session_factory: SessionFactory,
    db: Any,
    client: EmailClient,
    settings: Settings,
    doc: dict[str, Any],
    message: dict[str, Any],
    report: SyncReport,
    attempt: _SendAttempt,
) -> None:
    conv_id = doc["_id"]
    # Ne pas expédier un instantané lu avant un STOP, une clôture ou un arrêt d'urgence.
    doc = await conversations.get_doc(db, str(conv_id))
    message = next(m for m in doc["messages"] if m["id"] == message["id"])
    async with session_factory() as session:
        prospect = await get_prospect(session, doc["prospect_id"])
        recipient = (prospect.email or "").lower()
        opted_out = prospect.consent_status is ConsentStatus.OPTED_OUT

    block: str | None = None
    if doc.get("status") == "closed":
        block = "conversation clôturée"
    elif recipient.endswith(DEMO_DOMAINS):
        block = "adresse fictive (démo) : jamais d'envoi réel"
    elif opted_out:
        block = "prospect désinscrit (S-03)"
    elif not recipient:
        block = "le prospect n'a pas d'adresse email"
    elif settings.email_sandbox_list and recipient not in settings.email_sandbox_list:
        block = "destinataire hors bac à sable"
    if block is not None:
        await _finish(db, conv_id, message, "blocked", reason=block, at=_now())
        report.blocked += 1
        return

    if message["role"] == SenderType.AGENT.value:
        mode = await agent_settings.get_mode(db)
        if mode is AgentMode.MANUAL:
            await _finish(db, conv_id, message, "not_sent")
            report.skipped += 1
            report.notes.append("envois de l'agent suspendus (arrêt d'urgence)")
            return
        metadata = message.get("metadata") or {}
        draft = metadata.get("draft")
        if draft is not None and draft.get("status") != "approved":
            await _finish(db, conv_id, message, "blocked", reason="brouillon non validé")
            report.blocked += 1
            return
        if mode is AgentMode.ASSISTED and draft is None and metadata.get("mode") != "handoff":
            # Reprise après le mode auto : aucun ancien message autonome ne contourne la revue.
            message["metadata"] = {**metadata, "draft": {"status": "pending"}}
            await _finish(db, conv_id, message, "draft")
            report.skipped += 1
            report.notes.append("message automatique remis en brouillon pour validation")
            return
    subject, in_reply_to, references = _thread_headers(doc, message)
    attempts = int((message.get("metadata") or {}).get("delivery_info", {}).get("attempts", 0)) + 1
    try:
        attempt.smtp_started = True
        message_id = await client.send(
            OutboundEmail(
                to_address=recipient,
                subject=subject,
                text=_with_footer(message["content"], settings),
                in_reply_to=in_reply_to,
                references=references,
            )
        )
    except Exception as exc:  # EmailError, mais aussi en-tête invalide : jamais bloqué en `sending`
        if not isinstance(exc, EmailError):
            logger.exception("Envoi du message %s en erreur", message.get("id"))
        again = attempts < MAX_ATTEMPTS
        await _finish(
            db,
            conv_id,
            message,
            "not_sent" if again else "failed",
            attempts=attempts,
            error=(str(exc) if isinstance(exc, EmailError) else type(exc).__name__)[:300],
            at=_now(),
        )
        if again:
            report.retried += 1
        else:
            report.failed += 1
        report.notes.append(f"envoi {message['id']} : {exc}")
        return
    await _finish(
        db, conv_id, message, "sent", attempts=attempts, email_message_id=message_id, at=_now()
    )
    report.sent += 1


async def deliver_outbox(
    session_factory: SessionFactory,
    db: Any,
    client: EmailClient,
    settings: Settings,
    report: SyncReport | None = None,
) -> SyncReport:
    report = report or SyncReport()
    if not settings.email_send_enabled:
        report.notes.append("envoi désactivé (EMAIL_SEND_ENABLED)")
        return report
    sent_this_cycle = 0
    cursor = db[conversations.COLLECTION].find(
        {
            "channel": CHANNEL,
            "simulation": {"$exists": False},
            "messages.metadata.delivery": "not_sent",
        }
    )
    async for doc in cursor:
        for message in _outbound_candidates(doc):
            if (
                message["role"] == SenderType.AGENT.value
                and await agent_settings.get_mode(db) is AgentMode.MANUAL
            ):
                # Les réponses manuelles restent disponibles, même avec beaucoup d'emails suspendus.
                report.skipped += 1
                if "envois de l'agent suspendus (arrêt d'urgence)" not in report.notes:
                    report.notes.append("envois de l'agent suspendus (arrêt d'urgence)")
                continue
            if sent_this_cycle >= OUTBOX_BATCH:
                return report
            sent_this_cycle += 1
            try:
                await _deliver_one(session_factory, db, client, settings, doc, message, report)
            except Exception:
                logger.exception("Envoi du message %s en erreur", message.get("id"))
                report.errors += 1
    return report


# --- Cycle, état, statut -----------------------------------------------------------------------


async def run_email_cycle(
    session_factory: SessionFactory,
    db: Any,
    client: EmailClient,
    settings: Settings,
    on_message: OnMessage | None = None,
) -> SyncReport:
    """Un passage : réception puis envoi. Une panne de la boîte est consignée, jamais propagée."""
    report = SyncReport()
    error: str | None = None
    try:
        inbound = await sync_inbound(session_factory, db, client, settings, on_message)
        report = inbound
    except EmailError as exc:
        error = f"réception : {exc}"
    try:
        await deliver_outbox(session_factory, db, client, settings, report)
    except EmailError as exc:
        error = f"envoi : {exc}"
    await db[agent_settings.COLLECTION].update_one(
        {"_id": STATE_ID},
        {"$set": {"last_run_at": _now(), "last_error": error, "last_report": report.as_dict()}},
        upsert=True,
    )
    return report


async def get_state(db: Any) -> dict[str, Any]:
    doc = await db[agent_settings.COLLECTION].find_one({"_id": STATE_ID}) or {}
    return {
        "last_run_at": doc.get("last_run_at"),
        "last_error": doc.get("last_error"),
        "last_report": doc.get("last_report"),
    }


async def outbox_counts(db: Any) -> dict[str, int]:
    rows = db[conversations.COLLECTION].aggregate(
        [
            {"$match": {"channel": CHANNEL}},
            {"$unwind": "$messages"},
            {"$match": {"messages.metadata.delivery": {"$exists": True}}},
            {"$group": {"_id": "$messages.metadata.delivery", "n": {"$sum": 1}}},
        ]
    )
    return {row["_id"]: row["n"] async for row in rows}
