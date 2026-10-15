from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Query, Response, status

from app.agents import auto
from app.api.dependencies import (
    ANY_ROLE,
    CAN_WRITE,
    CalendarDep,
    CurrentUser,
    DbSession,
    KnowledgeDep,
    Llm,
    MongoDb,
    SessionFactoryDep,
    SettingsDep,
)
from app.graph import policy
from app.models.enums import ConversationStatus, SenderType
from app.schemas.common import Page
from app.schemas.conversation import (
    ConversationCreate,
    ConversationRead,
    ConversationResult,
    ConversationSummary,
    ConversationUpdate,
    MessageCreate,
    MessageResult,
)
from app.services import agent_events, drafts, follow_ups, inbox
from app.services import conversations as service

router = APIRouter(tags=["conversations"], dependencies=[ANY_ROLE])


async def trigger_agent(
    background: BackgroundTasks,
    settings: SettingsDep,
    conversation_id: str,
    session_factory: SessionFactoryDep,
    db: MongoDb,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
) -> None:
    """Dès qu'un message du prospect est enregistré, l'agent prépare sa réponse (F-06)."""
    if settings.agent_auto_reply:
        await agent_events.enqueue_reply(db, conversation_id)
        background.add_task(
            auto.reply_to_message,
            conversation_id,
            session_factory=session_factory,
            db=db,
            llm=llm,
            calendar=calendar,
            knowledge=knowledge,
        )


@router.post(
    "/conversations",
    response_model=ConversationResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def create_conversation(
    payload: ConversationCreate,
    session: DbSession,
    db: MongoDb,
    response: Response,
    background: BackgroundTasks,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
    user: CurrentUser,
) -> ConversationResult:
    """Ouvre une conversation (201), ou renvoie la conversation active existante (200).
    Si elle s'ouvre sur un message du prospect, l'agent prépare sa réponse."""
    if payload.message is not None:
        payload.message.metadata = {
            k: v for k, v in payload.message.metadata.items() if k not in service.RESERVED_METADATA
        }
        if payload.message.role is SenderType.ADVISOR:
            payload.message.metadata["author_id"] = user.id
    conversation, created = await service.create_conversation(session, db, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    if (
        payload.message is not None
        and payload.message.role is SenderType.PROSPECT
        and not policy.is_opt_out(payload.message.content)
    ):
        await trigger_agent(
            background, settings, conversation.id, session_factory, db, llm, calendar, knowledge
        )
    return ConversationResult(conversation=conversation, created=created)


@router.get("/conversations", response_model=Page[ConversationSummary])
async def list_conversations(
    session: DbSession,
    db: MongoDb,
    status_: Annotated[ConversationStatus | None, Query(alias="status")] = None,
    channel: str | None = None,
    q: Annotated[str | None, Query(description="Nom ou email du prospect")] = None,
    advisor_id: Annotated[int | None, Query(description="Conseiller affecté")] = None,
    unassigned: Annotated[bool, Query(description="Prospects sans conseiller")] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ConversationSummary]:
    """Boîte de réception : conversations enrichies du prospect (nom, étape, score).
    `?status=handed_off` : file des transferts (F-20)."""
    items, total = await inbox.list_inbox(
        session, db, status=status_, channel=channel, q=q, advisor_id=advisor_id,
        unassigned=unassigned, limit=limit, offset=offset,
    )  # fmt: skip
    return Page[ConversationSummary](items=items, total=total, limit=limit, offset=offset)


@router.get("/conversations/{conversation_id}", response_model=ConversationRead)
async def get_conversation(conversation_id: str, db: MongoDb) -> ConversationRead:
    return await service.get_conversation(db, conversation_id)


@router.patch(
    "/conversations/{conversation_id}",
    response_model=ConversationRead,
    dependencies=[CAN_WRITE],
)
async def update_conversation(
    conversation_id: str, payload: ConversationUpdate, session: DbSession, db: MongoDb
) -> ConversationRead:
    """Statut (open, handed_off, closed) et résumé. Clôturer ou transférer annule les relances."""
    conversation = await service.update_conversation(db, conversation_id, payload)
    if conversation.status in (ConversationStatus.HANDED_OFF, ConversationStatus.CLOSED):
        await follow_ups.cancel_pending(session, conversation.prospect_id)
    if conversation.status is ConversationStatus.CLOSED:
        await drafts.cancel_pending_for_conversation(db, conversation_id)
    return conversation


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
    background: BackgroundTasks,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
    user: CurrentUser,
) -> MessageResult:
    """Ajoute un message. Rejeu avec le même `external_message_id` : 200, sans doublon.
    Un message du prospect déclenche la réponse de l'agent (en tâche de fond, F-06).
    Les clés réservées (`delivery`, `draft`...) sont retirées : le serveur décide de l'envoi."""
    payload.metadata = {
        k: v for k, v in payload.metadata.items() if k not in service.RESERVED_METADATA
    }
    if payload.role is SenderType.ADVISOR:
        payload.metadata["author_id"] = user.id
    message, created = await service.add_message(session, db, conversation_id, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    elif payload.role is SenderType.PROSPECT:
        if policy.is_opt_out(message.content):
            return MessageResult(conversation_id=conversation_id, message=message, created=created)
        await trigger_agent(
            background, settings, conversation_id, session_factory, db, llm, calendar, knowledge
        )
    return MessageResult(conversation_id=conversation_id, message=message, created=created)


@router.get("/prospects/{prospect_id}/conversation", response_model=ConversationRead)
async def get_prospect_conversation(
    prospect_id: int, session: DbSession, db: MongoDb, channel: str | None = None
) -> ConversationRead:
    """Conversation la plus récente du prospect (filtrable par canal)."""
    return await service.latest_for_prospect(session, db, prospect_id, channel)
