from fastapi import APIRouter, status

from app.agents import runtime
from app.api.dependencies import (
    ANY_ROLE,
    CAN_WRITE,
    VISIBLE_PROSPECT,
    CalendarDep,
    CurrentScope,
    DbSession,
    KnowledgeDep,
    Llm,
    MongoDb,
)
from app.schemas.agent import AgentRunRequest, AgentRunResult
from app.services import conversations
from app.services import scope as scope_service

router = APIRouter(tags=["agent"], dependencies=[ANY_ROLE])


@router.post(
    "/agent/runs",
    response_model=AgentRunResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def run_agent(
    payload: AgentRunRequest,
    session: DbSession,
    db: MongoDb,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
    scope: CurrentScope,
) -> AgentRunResult:
    """Exécute le workflow sur le dernier message du prospect (ou ouvre le premier contact).

    Le résultat contient la décision, sa justification, le message rédigé et la trace des noeuds.
    Le message est enregistré dans la conversation mais pas encore envoyé sur le canal
    (les connecteurs de messagerie viendront ensuite).
    """
    if scope.restricted:
        prospect_id = payload.prospect_id
        if payload.conversation_id is not None:
            prospect_id = int(
                (await conversations.get_doc(db, payload.conversation_id))["prospect_id"]
            )
        if prospect_id is not None:
            await scope_service.ensure_visible(session, scope, prospect_id)
    return await runtime.run_agent(
        session,
        db,
        llm=llm,
        calendar=calendar,
        knowledge=knowledge,
        conversation_id=payload.conversation_id,
        prospect_id=payload.prospect_id,
        channel=payload.channel,
    )


@router.get("/agent/runs/{run_id}", response_model=AgentRunResult)
async def get_run(
    run_id: str, session: DbSession, db: MongoDb, scope: CurrentScope
) -> AgentRunResult:
    run = await runtime.get_run(db, run_id)
    await scope_service.ensure_visible(session, scope, run.prospect_id)
    return run


@router.get(
    "/prospects/{prospect_id}/agent-runs",
    response_model=list[AgentRunResult],
    dependencies=[VISIBLE_PROSPECT],
)
async def list_runs(prospect_id: int, session: DbSession, db: MongoDb) -> list[AgentRunResult]:
    """Dernières exécutions de l'agent pour ce prospect (explicabilité, OB-05)."""
    return await runtime.list_runs(session, db, prospect_id)
