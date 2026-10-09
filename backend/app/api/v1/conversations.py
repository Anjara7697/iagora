from fastapi import APIRouter, Response, status

from app.api.dependencies import ANY_ROLE, CAN_WRITE, DbSession, MongoDb
from app.schemas.conversation import (
    ConversationCreate,
    ConversationRead,
    ConversationResult,
    ConversationUpdate,
    MessageCreate,
    MessageResult,
)
from app.services import conversations as service

router = APIRouter(tags=["conversations"], dependencies=[ANY_ROLE])


@router.post(
    "/conversations",
    response_model=ConversationResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def create_conversation(
    payload: ConversationCreate, session: DbSession, db: MongoDb, response: Response
) -> ConversationResult:
    """Ouvre une conversation (201), ou renvoie la conversation active existante (200)."""
    conversation, created = await service.create_conversation(session, db, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return ConversationResult(conversation=conversation, created=created)


@router.get("/conversations/{conversation_id}", response_model=ConversationRead)
async def get_conversation(conversation_id: str, db: MongoDb) -> ConversationRead:
    return await service.get_conversation(db, conversation_id)


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    dependencies=[CAN_WRITE],
)
async def update_conversation(
    conversation_id: str, payload: ConversationUpdate, db: MongoDb
) -> ConversationRead:
    """Statut (open, handed_off, closed) et résumé."""
    return await service.update_conversation(db, conversation_id, payload)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=MessageResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def add_message(
    conversation_id: str,
    payload: MessageCreate,
    session: DbSession,
    db: MongoDb,
    response: Response,
) -> MessageResult:
    """Ajoute un message. Rejeu avec le même `external_message_id` : 200, sans doublon."""
    message, created = await service.add_message(session, db, conversation_id, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return MessageResult(conversation_id=conversation_id, message=message, created=created)


@router.get("/prospects/{prospect_id}/conversation", response_model=ConversationRead)
async def get_prospect_conversation(
    prospect_id: int, session: DbSession, db: MongoDb, channel: str | None = None
) -> ConversationRead:
    """Conversation la plus récente du prospect (filtrable par canal)."""
    return await service.latest_for_prospect(session, db, prospect_id, channel)
