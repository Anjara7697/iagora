"""Raccordement rejouable d'une entrée SQL à son message MongoDB."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, Interaction
from app.models.enums import SenderType
from app.schemas.conversation import ConversationCreate, MessageCreate
from app.services import conversations


async def route_entry(session: AsyncSession, db: Any, entry: Interaction) -> str | None:
    if entry.conversation_ref:
        return entry.conversation_ref
    channel = await session.get(Channel, entry.channel_id) if entry.channel_id else None
    if channel is None:
        return None  # aucune supposition sur le canal autorisé
    external_id = f"entry:{entry.id}"
    # Réparer aussi un échec après l'écriture Mongo, même si le fil a été clôturé depuis.
    found = await db[conversations.COLLECTION].find_one(
        {
            "prospect_id": entry.prospect_id,
            "messages.external_message_id": external_id,
        }
    )
    if found:
        entry.conversation_ref = str(found["_id"])
        entry.content = None
        await session.commit()
        return entry.conversation_ref
    conversation, _ = await conversations.create_conversation(
        session,
        db,
        ConversationCreate(
            prospect_id=entry.prospect_id,
            channel=channel.name,
        ),
    )
    if entry.content:
        await conversations.add_message(
            session,
            db,
            conversation.id,
            MessageCreate(
                role=SenderType.PROSPECT,
                content=entry.content,
                external_message_id=external_id,
                metadata={"entry_interaction_id": entry.id},
            ),
        )
    else:
        entry.conversation_ref = conversation.id
        await session.commit()
    return conversation.id
