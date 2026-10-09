"""Conversations et messages, stockés dans MongoDB (CdC §9.4, §9.5).

Une conversation est un document : prospect, canal, statut, résumé et messages horodatés.
PostgreSQL ne garde qu'un journal léger (`interactions`, avec `conversation_ref`) : le contenu
d'un message n'existe qu'à un seul endroit.

Cohérence entre les deux bases (pas de transaction commune) : le message est écrit dans MongoDB
d'abord, puis journalisé dans PostgreSQL. Un rejeu avec le même `external_message_id` ne recrée
pas le message mais répare le journal s'il manque.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Interaction
from app.models.enums import (
    ConsentStatus,
    ConversationStatus,
    Direction,
    SenderType,
)
from app.schemas.conversation import (
    ConversationCreate,
    ConversationRead,
    ConversationSummary,
    ConversationUpdate,
    MessageCreate,
    MessageRead,
)
from app.services import follow_ups, references
from app.services.errors import ConflictError, NotFoundError
from app.services.prospects import get_prospect

logger = logging.getLogger(__name__)

COLLECTION = "conversations"
ACTIVE = [ConversationStatus.OPEN.value, ConversationStatus.HANDED_OFF.value]
OUTBOUND_ROLES = {SenderType.AGENT, SenderType.ADVISOR}

Db = Any  # AsyncIOMotorDatabase


async def ensure_indexes(db: Db) -> None:
    col = db[COLLECTION]
    await col.create_index([("prospect_id", ASCENDING), ("last_message_at", DESCENDING)])
    # Une seule conversation active (ouverte ou transférée) par prospect et par canal.
    await col.create_index(
        [("prospect_id", ASCENDING), ("channel", ASCENDING)],
        unique=True,
        partialFilterExpression={"status": {"$in": ACTIVE}},
        name="uq_active_conversation_per_prospect_channel",
    )


def _now() -> datetime:
    return datetime.now(UTC)


def _oid(conversation_id: str) -> ObjectId:
    try:
        return ObjectId(conversation_id)
    except (InvalidId, TypeError):
        raise NotFoundError(f"Conversation {conversation_id} introuvable") from None


def to_read(doc: dict[str, Any]) -> ConversationRead:
    return ConversationRead(
        id=str(doc["_id"]),
        prospect_id=doc["prospect_id"],
        channel=doc["channel"],
        status=doc["status"],
        summary=doc.get("summary"),
        started_at=doc["started_at"],
        last_message_at=doc.get("last_message_at"),
        closed_at=doc.get("closed_at"),
        messages=[MessageRead(**m) for m in doc.get("messages", [])],
        handoff=doc.get("handoff"),
    )


def _message_doc(data: MessageCreate) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex,
        "role": data.role.value,
        "content": data.content,
        "external_message_id": data.external_message_id,
        "created_at": _now(),
        "metadata": data.metadata,
    }


async def _get_doc(db: Db, conversation_id: str) -> dict[str, Any]:
    doc = await db[COLLECTION].find_one({"_id": _oid(conversation_id)})
    if doc is None:
        raise NotFoundError(f"Conversation {conversation_id} introuvable")
    return doc  # type: ignore[no-any-return]


async def get_doc(db: Db, conversation_id: str) -> dict[str, Any]:
    """Document brut de la conversation (usage interne : workflow, passerelle)."""
    return await _get_doc(db, conversation_id)


async def set_handoff(db: Db, conversation_id: str, sheet: dict[str, Any]) -> None:
    """Enregistre la fiche de transfert (F-21) et passe la conversation à `handed_off`.
    Une conversation clôturée garde son statut."""
    doc = await _get_doc(db, conversation_id)
    changes: dict[str, Any] = {
        "handoff": {**sheet, "created_at": _now()},
        "summary": sheet.get("summary") or doc.get("summary"),
    }
    if doc["status"] == ConversationStatus.OPEN.value:
        changes["status"] = ConversationStatus.HANDED_OFF.value
    await db[COLLECTION].update_one({"_id": doc["_id"]}, {"$set": changes})
    logger.info(
        "Conversation %s transférée à un conseiller : %s", conversation_id, sheet.get("reason")
    )


async def get_conversation(db: Db, conversation_id: str) -> ConversationRead:
    return to_read(await _get_doc(db, conversation_id))


def to_summary(doc: dict[str, Any]) -> ConversationSummary:
    last = doc.get("last_message")
    return ConversationSummary(
        id=str(doc["_id"]),
        prospect_id=doc["prospect_id"],
        channel=doc["channel"],
        status=doc["status"],
        started_at=doc["started_at"],
        last_message_at=doc.get("last_message_at"),
        message_count=doc.get("message_count", 0),
        last_message_role=last["role"] if last else None,
        last_message_preview=last["content"][:160] if last else None,
        handoff=doc.get("handoff"),
    )


async def list_conversations(
    db: Db, status: ConversationStatus | None, limit: int, offset: int
) -> tuple[list[ConversationSummary], int]:
    """Conversations, les plus récemment actives d'abord (sans transférer tout l'historique)."""
    match: dict[str, Any] = {"status": status.value} if status else {}
    col = db[COLLECTION]
    total = await col.count_documents(match)
    pipeline: list[dict[str, Any]] = [
        {"$match": match},
        {"$sort": {"last_message_at": -1, "started_at": -1}},
        {"$skip": offset},
        {"$limit": limit},
        {
            "$project": {
                "prospect_id": 1, "channel": 1, "status": 1, "started_at": 1,
                "last_message_at": 1, "handoff": 1,
                "message_count": {"$size": {"$ifNull": ["$messages", []]}},
                "last_message": {"$arrayElemAt": [{"$ifNull": ["$messages", []]}, -1]},
            }
        },
    ]  # fmt: skip
    return [to_summary(doc) async for doc in col.aggregate(pipeline)], total


async def latest_for_prospect(
    session: AsyncSession, db: Db, prospect_id: int, channel: str | None
) -> ConversationRead:
    """Conversation la plus récemment active du prospect (GET /prospects/{id}/conversation)."""
    await get_prospect(session, prospect_id)
    query: dict[str, Any] = {"prospect_id": prospect_id}
    if channel:
        found = await references.get_channel(session, channel)
        assert found is not None  # noqa: S101 - get_channel lève si inconnu
        query["channel"] = found.name
    docs = await db[COLLECTION].find(query).sort("started_at", DESCENDING).to_list(None)
    if not docs:
        raise NotFoundError("Aucune conversation pour ce prospect")
    docs.sort(key=lambda d: d.get("last_message_at") or d["started_at"], reverse=True)
    return to_read(docs[0])


async def create_conversation(
    session: AsyncSession, db: Db, data: ConversationCreate
) -> tuple[ConversationRead, bool]:
    """Ouvre une conversation, ou retourne celle déjà active pour ce prospect et ce canal."""
    await get_prospect(session, data.prospect_id)
    channel = await references.get_channel(session, data.channel)
    assert channel is not None  # noqa: S101 - get_channel lève si inconnu
    query = {"prospect_id": data.prospect_id, "channel": channel.name, "status": {"$in": ACTIVE}}
    new_doc = {
        "prospect_id": data.prospect_id,
        "channel": channel.name,
        "status": ConversationStatus.OPEN.value,
        "summary": None,
        "started_at": _now(),
        "last_message_at": None,
        "closed_at": None,
        "messages": [],
    }
    created = False
    try:
        existing = await db[COLLECTION].find_one(query)
        if existing is None:
            inserted = await db[COLLECTION].insert_one(new_doc)
            new_doc["_id"] = inserted.inserted_id
            doc, created = new_doc, True
        else:
            doc = existing
    except DuplicateKeyError:  # création concurrente : on reprend la gagnante
        doc = await db[COLLECTION].find_one(query)
        if doc is None:
            raise ConflictError("Conflit lors de la création de la conversation") from None

    if data.message is not None:
        await add_message(session, db, str(doc["_id"]), data.message)
        doc = await _get_doc(db, str(doc["_id"]))
    return to_read(doc), created


async def add_message(
    session: AsyncSession, db: Db, conversation_id: str, data: MessageCreate
) -> tuple[MessageRead, bool]:
    """Ajoute un message. Retourne (message, créé). Idempotent sur `external_message_id`."""
    oid = _oid(conversation_id)
    doc = await _get_doc(db, conversation_id)
    prospect = await get_prospect(session, doc["prospect_id"])

    if doc["status"] == ConversationStatus.CLOSED.value:
        raise ConflictError("La conversation est clôturée")
    if data.role in OUTBOUND_ROLES and prospect.consent_status is ConsentStatus.OPTED_OUT:
        raise ConflictError("Le prospect s'est désinscrit : aucune communication sortante (S-03)")

    message = _message_doc(data)
    guard: dict[str, Any] = {"_id": oid, "status": {"$ne": ConversationStatus.CLOSED.value}}
    if data.external_message_id:
        guard["messages.external_message_id"] = {"$ne": data.external_message_id}
    # Filtre et ajout dans une seule opération atomique : pas de doublon même en concurrence.
    result = await db[COLLECTION].update_one(
        guard, {"$push": {"messages": message}, "$set": {"last_message_at": message["created_at"]}}
    )
    created = result.modified_count == 1
    if not created:
        refreshed = await _get_doc(db, conversation_id)
        if refreshed["status"] == ConversationStatus.CLOSED.value:
            raise ConflictError("La conversation est clôturée")
        message = next(
            m
            for m in refreshed["messages"]
            if m.get("external_message_id") == data.external_message_id
        )

    await _ensure_journal(session, doc, message, data.role)
    if created and data.role is SenderType.PROSPECT:
        await follow_ups.cancel_pending(session, doc["prospect_id"])  # il répond : plus de relance
    return MessageRead(**message), created


async def _ensure_journal(
    session: AsyncSession, doc: dict[str, Any], message: dict[str, Any], role: SenderType
) -> None:
    """Journalise le message dans `interactions` (sans son contenu), une seule fois."""
    channel = await references.get_channel(session, doc["channel"])
    assert channel is not None  # noqa: S101
    external_id = message.get("external_message_id") or f"msg:{message['id']}"
    existing = await session.scalar(
        select(Interaction.id).where(
            Interaction.channel_id == channel.id, Interaction.external_id == external_id
        )
    )
    if existing is not None:
        return
    inbound = role is SenderType.PROSPECT
    session.add(
        Interaction(
            prospect_id=doc["prospect_id"],
            channel_id=channel.id,
            type="message",
            direction=Direction.INBOUND if inbound else Direction.OUTBOUND,
            external_id=external_id,
            conversation_ref=str(doc["_id"]),
            intent=(message.get("metadata") or {}).get("intent"),
        )
    )
    if inbound:
        prospect = await get_prospect(session, doc["prospect_id"])
        prospect.current_channel_id = channel.id
    try:
        await session.commit()
    except IntegrityError:  # rejeu concurrent : l'autre requête a déjà journalisé ce message
        await session.rollback()


_ALLOWED = {
    ConversationStatus.OPEN.value: {ConversationStatus.HANDED_OFF, ConversationStatus.CLOSED},
    ConversationStatus.HANDED_OFF.value: {ConversationStatus.OPEN, ConversationStatus.CLOSED},
    ConversationStatus.CLOSED.value: set(),
}


async def update_conversation(
    db: Db, conversation_id: str, data: ConversationUpdate
) -> ConversationRead:
    """Changement de statut (transfert à un conseiller, clôture) et résumé."""
    doc = await _get_doc(db, conversation_id)
    changes: dict[str, Any] = {}
    if data.status is not None and data.status.value != doc["status"]:
        if data.status not in _ALLOWED[doc["status"]]:
            raise ConflictError(f"Transition impossible : {doc['status']} -> {data.status.value}")
        changes["status"] = data.status.value
        if data.status is ConversationStatus.CLOSED:
            changes["closed_at"] = _now()
    if "summary" in data.model_fields_set:
        changes["summary"] = data.summary
    if changes:
        doc = await db[COLLECTION].find_one_and_update(
            {"_id": doc["_id"]}, {"$set": changes}, return_document=ReturnDocument.AFTER
        )
        logger.info("Conversation %s mise à jour : %s", conversation_id, sorted(changes))
    return to_read(doc)
