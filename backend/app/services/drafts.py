"""Brouillons de l'agent : réponses à valider par un conseiller avant envoi (mode assisté).

Un brouillon est un message de l'agent dont `metadata.draft.status` vaut :
`pending` (à valider), `approved`, `rejected` (avec motif), `superseded` (remplacé par une
nouvelle version) ou `cancelled` (désinscription du prospect). Seul un brouillon `pending` peut
être traité ; les brouillons « morts » (`rejected`, `superseded`, `cancelled`) ne comptent plus
dans le fil, ce qui permet à l'agent ou au conseiller de répondre à nouveau.
"""

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId

from app.schemas.conversation import MessageRead
from app.services import conversations
from app.services.errors import ConflictError, NotFoundError

PENDING = "pending"
DEAD = {"rejected", "superseded", "cancelled"}


def draft_of(message: dict[str, Any]) -> dict[str, Any] | None:
    draft = (message.get("metadata") or {}).get("draft")
    return draft if isinstance(draft, dict) else None


def is_dead(message: dict[str, Any]) -> bool:
    draft = draft_of(message)
    return draft is not None and draft.get("status") in DEAD


def is_pending(message: dict[str, Any]) -> bool:
    draft = draft_of(message)
    return draft is not None and draft.get("status") == PENDING


def live_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fil sans les brouillons refusés, remplacés ou annulés."""
    return [m for m in messages if not is_dead(m)]


async def _pending(db: Any, conversation_id: str, message_id: str) -> dict[str, Any]:
    doc = await conversations.get_doc(db, conversation_id)
    for message in doc.get("messages", []):
        if message["id"] == message_id:
            if not is_pending(message):
                raise ConflictError("Ce brouillon a déjà été traité")
            found: dict[str, Any] = message
            return found
    raise NotFoundError("Brouillon introuvable")


async def _update(
    db: Any, conversation_id: str, message_id: str, fields: dict[str, Any], content: str | None
) -> MessageRead:
    match = {"_id": ObjectId(conversation_id), "messages.id": message_id}
    # Une mise à jour par chemin racine : mongomock gère mal plusieurs « $ » dans un même $set.
    # Le statut est écrit en dernier (il fait foi pour la file « À traiter »).
    first: list[dict[str, Any]] = []
    if content is not None:
        first.append({"messages.$.content": content})
    if fields.get("status") == "approved":
        first.append({"messages.$.metadata.delivery": "not_sent"})  # validé ; envoi à venir
    for update in first:
        await db[conversations.COLLECTION].update_one(match, {"$set": update})
    result = await db[conversations.COLLECTION].update_one(
        match, {"$set": {f"messages.$.metadata.draft.{k}": v for k, v in fields.items()}}
    )
    if result.matched_count == 0:
        raise NotFoundError("Brouillon introuvable")
    doc = await conversations.get_doc(db, conversation_id)
    message = next(m for m in doc["messages"] if m["id"] == message_id)
    return MessageRead(**message)


async def approve(
    db: Any, conversation_id: str, message_id: str, actor_id: int, content: str | None
) -> MessageRead:
    """Valide le brouillon, éventuellement modifié (le texte d'origine est conservé)."""
    message = await _pending(db, conversation_id, message_id)
    edited = content is not None and content.strip() != message["content"].strip()
    fields: dict[str, Any] = {
        "status": "approved",
        "decided_by": actor_id,
        "decided_at": datetime.now(UTC),
        "edited": edited,
    }
    if edited:
        fields["original_content"] = message["content"]
    return await _update(
        db, conversation_id, message_id, fields, content.strip() if edited and content else None
    )


async def reject(
    db: Any, conversation_id: str, message_id: str, actor_id: int, reason: str
) -> MessageRead:
    await _pending(db, conversation_id, message_id)
    fields = {
        "status": "rejected",
        "decided_by": actor_id,
        "decided_at": datetime.now(UTC),
        "reason": reason,
    }
    return await _update(db, conversation_id, message_id, fields, None)


async def supersede(db: Any, conversation_id: str, message_id: str, actor_id: int) -> MessageRead:
    await _pending(db, conversation_id, message_id)
    fields = {
        "status": "superseded",
        "decided_by": actor_id,
        "decided_at": datetime.now(UTC),
    }
    return await _update(db, conversation_id, message_id, fields, None)


async def cancel_pending_for_prospect(db: Any, prospect_id: int) -> int:
    """Désinscription : les brouillons en attente ne partiront jamais (S-03)."""
    docs = db[conversations.COLLECTION].find(
        {"prospect_id": prospect_id, "messages.metadata.draft.status": PENDING}
    )
    cancelled = 0
    async for doc in docs:
        for message in doc.get("messages", []):
            if is_pending(message):
                await db[conversations.COLLECTION].update_one(
                    {"_id": doc["_id"], "messages.id": message["id"]},
                    {"$set": {"messages.$.metadata.draft.status": "cancelled"}},
                )
                cancelled += 1
    return cancelled
