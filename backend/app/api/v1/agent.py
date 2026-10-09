from fastapi import APIRouter, status

from app.agents import runtime
from app.api.dependencies import (
    ANY_ROLE,
    CAN_WRITE,
    CalendarDep,
    DbSession,
    KnowledgeDep,
    Llm,
    MongoDb,
)
from app.schemas.agent import AgentRunRequest, AgentRunResult

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
) -> AgentRunResult:
    """Exécute le workflow sur le dernier message du prospect (ou ouvre le premier contact).

    Le résultat contient la décision, sa justification, le message rédigé et la trace des noeuds.
    Le message est enregistré dans la conversation mais pas encore envoyé sur le canal
    (les connecteurs de messagerie viendront ensuite).
    """
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
async def get_run(run_id: str, db: MongoDb) -> AgentRunResult:
    return await runtime.get_run(db, run_id)


@router.get("/prospects/{prospect_id}/agent-runs", response_model=list[AgentRunResult])
async def list_runs(prospect_id: int, session: DbSession, db: MongoDb) -> list[AgentRunResult]:
    """Dernières exécutions de l'agent pour ce prospect (explicabilité, OB-05)."""
    return await runtime.list_runs(session, db, prospect_id)
