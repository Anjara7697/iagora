from fastapi import APIRouter

from app.api.dependencies import ANY_ROLE, DbSession, MongoDb
from app.schemas.dashboard import DashboardSummary
from app.services import dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[ANY_ROLE])


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(session: DbSession, db: MongoDb) -> DashboardSummary:
    """Synthèse de l'écran « Aujourd'hui » (prospects fictifs exclus)."""
    return await dashboard.summary(session, db)
