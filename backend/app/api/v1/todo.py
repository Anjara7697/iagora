from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.agents import runtime
from app.api.dependencies import (
    ANY_ROLE,
    CAN_WRITE,
    CalendarDep,
    CurrentUser,
    DbSession,
    KnowledgeDep,
    Llm,
    MongoDb,
    SettingsDep,
)
from app.models.enums import UserRole
from app.schemas.agent import AgentRunResult
from app.schemas.conversation import MessageRead
from app.schemas.todo import (
    AgentModeRead,
    AgentModeUpdate,
    DraftApprove,
    DraftReject,
    TodoItem,
    TodoPage,
    TreatedPage,
)
from app.services import agent_settings, drafts, email_format, prospects
from app.services import conversations as conversation_service
from app.services import todo as todo_service
from app.services.agent_settings import AgentMode
from app.services.errors import ConflictError, NotFoundError

router = APIRouter(tags=["assisted-mode"], dependencies=[ANY_ROLE])


@router.get("/todo", response_model=TodoPage)
async def list_todo(
    session: DbSession,
    db: MongoDb,
    settings: SettingsDep,
    kind: Annotated[str | None, Query(pattern="^(validation|escalation|kb_gap|incident)$")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> TodoPage:
    """Ce qui attend un conseiller : brouillons à valider, transferts, lacunes, incidents."""
    return await todo_service.list_todo(
        session,
        db,
        kind=kind,
        limit=limit,
        offset=offset,
        footer=email_format.footer_text(settings),
    )


@router.get("/todo/treated", response_model=TreatedPage)
async def list_treated(
    session: DbSession,
    db: MongoDb,
    hours: Annotated[int, Query(ge=1, le=168)] = 24,
) -> TreatedPage:
    """Brouillons déjà validés ou refusés, avec l'état d'envoi (la trace reste lisible)."""
    return await todo_service.treated(session, db, hours=hours)


@router.get("/todo/item", response_model=TodoItem)
async def get_todo_item(
    session: DbSession,
    db: MongoDb,
    settings: SettingsDep,
    id: Annotated[str, Query(min_length=1, max_length=200)],
) -> TodoItem:
    parts = id.split(":")
    if not (
        (len(parts) == 3 and parts[0] == "draft") or (len(parts) == 2 and parts[0] == "handoff")
    ):
        raise NotFoundError("Élément à traiter introuvable")
    result = await todo_service.list_todo(
        session,
        db,
        kind=None,
        limit=200,
        offset=0,
        footer=email_format.footer_text(settings),
        conversation_id=parts[1],
    )
    for item in result.items:
        if item.id == id:
            return item
    raise NotFoundError("Cet élément n’est plus à traiter ; consultez la conversation")


@router.get("/agent/mode", response_model=AgentModeRead)
async def get_agent_mode(db: MongoDb) -> AgentModeRead:
    setting = await agent_settings.get_setting(db)
    return AgentModeRead(
        mode=setting.mode, updated_by=setting.updated_by, updated_at=setting.updated_at
    )


@router.put("/agent/mode", response_model=AgentModeRead, dependencies=[CAN_WRITE])
async def set_agent_mode(payload: AgentModeUpdate, db: MongoDb, user: CurrentUser) -> AgentModeRead:
    """Mode de l'agent. Tout conseiller peut passer en `manual` (arrêt d'urgence) ou en `assisted` ;
    seul un administrateur peut autoriser l'envoi sans validation (`auto`)."""
    if payload.mode is AgentMode.AUTO and user.role is not UserRole.ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Seul un administrateur peut désactiver la validation"
        )
    setting = await agent_settings.set_mode(db, payload.mode, user.id)
    return AgentModeRead(
        mode=setting.mode, updated_by=setting.updated_by, updated_at=setting.updated_at
    )


async def _guard_consent(session: DbSession, db: MongoDb, conversation_id: str) -> None:
    doc = await conversation_service.get_doc(db, conversation_id)
    prospect = await prospects.get_prospect(session, int(doc["prospect_id"]))
    if prospect.consent_status.value == "opted_out":
        raise ConflictError("Le prospect s'est désinscrit : aucun message ne peut partir (S-03)")


@router.post(
    "/conversations/{conversation_id}/drafts/{message_id}/approve",
    response_model=MessageRead,
    dependencies=[CAN_WRITE],
)
async def approve_draft(
    conversation_id: str,
    message_id: str,
    payload: DraftApprove,
    session: DbSession,
    db: MongoDb,
    user: CurrentUser,
) -> MessageRead:
    """Valide le brouillon (éventuellement modifié) : il devient un message prêt à partir."""
    await _guard_consent(session, db, conversation_id)
    return await drafts.approve(db, conversation_id, message_id, user.id, payload.content)


@router.post(
    "/conversations/{conversation_id}/drafts/{message_id}/reject",
    response_model=MessageRead,
    dependencies=[CAN_WRITE],
)
async def reject_draft(
    conversation_id: str,
    message_id: str,
    payload: DraftReject,
    db: MongoDb,
    user: CurrentUser,
) -> MessageRead:
    """Refuse le brouillon, avec un motif : rien ne part et le fil est de nouveau libre."""
    return await drafts.reject(db, conversation_id, message_id, user.id, payload.reason)


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/retry-delivery",
    response_model=MessageRead,
    dependencies=[CAN_WRITE],
)
async def retry_delivery(conversation_id: str, message_id: str, db: MongoDb) -> MessageRead:
    """Relance l'envoi d'un message validé dont l'envoi a échoué ou été bloqué."""
    return await drafts.retry_delivery(db, conversation_id, message_id)


@router.post(
    "/conversations/{conversation_id}/drafts/{message_id}/regenerate",
    response_model=AgentRunResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def regenerate_draft(
    conversation_id: str,
    message_id: str,
    session: DbSession,
    db: MongoDb,
    user: CurrentUser,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
) -> AgentRunResult:
    """Remplace le brouillon par une nouvelle version rédigée par l'agent."""
    if await agent_settings.get_mode(db) is AgentMode.MANUAL:
        raise ConflictError("Agent en mode manuel (arrêt d'urgence) : aucune réponse automatique")
    await drafts.supersede(db, conversation_id, message_id, user.id)
    return await runtime.run_agent(
        session,
        db,
        llm=llm,
        calendar=calendar,
        knowledge=knowledge,
        conversation_id=conversation_id,
    )
