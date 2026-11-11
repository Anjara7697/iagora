from enum import IntEnum
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencies import ANY_ROLE, DbSession, MongoDb
from app.schemas.dashboard import AgentActivity, DashboardOverview, DashboardSummary
from app.services import dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[ANY_ROLE])


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(session: DbSession, db: MongoDb) -> DashboardSummary:
    """Synthèse de l'écran « Aujourd'hui » (prospects fictifs exclus)."""
    return await dashboard.summary(session, db)


class Period(IntEnum):
    WEEK = 7
    MONTH = 30
    QUARTER = 90


@router.get("/overview", response_model=DashboardOverview)
async def dashboard_overview(
    session: DbSession,
    days: Annotated[Period, Query(description="Période : 7, 30 ou 90 jours")] = Period.MONTH,
) -> DashboardOverview:
    """Tableau de bord (Pilotage) : entonnoir par étape atteinte, répartitions par programme et par
    source, sur les prospects arrivés dans la période (prospects fictifs exclus)."""
    return await dashboard.overview(session, int(days))


@router.get("/activity", response_model=AgentActivity)
async def agent_activity(
    session: DbSession,
    db: MongoDb,
    days: Annotated[Period, Query(description="Période : 7, 30 ou 90 jours")] = Period.WEEK,
) -> AgentActivity:
    """Activité de l'agent sur la période (écran Agent), prospects fictifs exclus."""
    return await dashboard.agent_activity(session, db, hours=int(days) * 24)
