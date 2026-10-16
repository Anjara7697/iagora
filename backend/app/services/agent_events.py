"""Demandes de traitement persistantes, identifiées par conversation et message entrant."""

from datetime import UTC, datetime
from typing import Any

from app.services import conversations, drafts


async def enqueue_reply(db: Any, conversation_id: str) -> str:
    doc = await conversations.get_doc(db, conversation_id)
    messages = drafts.live_messages(doc.get("messages", []))
    inbound_id = next((m["id"] for m in reversed(messages) if m["role"] == "prospect"), "first")
    event_id = f"{conversation_id}:{inbound_id}"
    await db["agent_events"].update_one(
        {"_id": event_id},
        {
            "$setOnInsert": {
                "conversation_id": conversation_id,
                "prospect_id": doc["prospect_id"],
                "completed": False,
                "created_at": datetime.now(UTC),
                "next_attempt_at": datetime.now(UTC),
            }
        },
        upsert=True,
    )
    return event_id
