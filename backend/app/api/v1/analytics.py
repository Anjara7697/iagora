from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencies import ANY_ROLE, CurrentScope, DbSession, MongoDb
from app.api.v1.dashboard import Period
from app.schemas.analytics import Analytics
from app.services import analytics

router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[ANY_ROLE])


@router.get("", response_model=Analytics)
async def get_analytics(
    session: DbSession,
    db: MongoDb,
    scope: CurrentScope,
    days: Annotated[Period, Query(description="Période : 7, 30 ou 90 jours")] = Period.MONTH,
) -> Analytics:
    """Analyses : délais de première réponse, brouillons, motifs de refus, couverture de la base
    de connaissances et conversion par étape (prospects fictifs exclus)."""
    return await analytics.analytics(session, db, int(days), scope)
