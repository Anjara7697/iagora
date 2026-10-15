from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import ADMIN_ONLY, DbSession, MongoDb, SettingsDep
from app.services import demo

router = APIRouter(prefix="/demo", tags=["demo"], dependencies=[ADMIN_ONLY])


@router.get("")
async def demo_summary(session: DbSession, db: MongoDb) -> dict[str, int]:
    """Combien de données fictives (simulateur, jeu de démonstration) sont en base."""
    return await demo.summary(session, db)


@router.delete("/data")
async def purge_demo_data(session: DbSession, db: MongoDb, settings: SettingsDep) -> dict[str, int]:
    """Supprime les prospects fictifs (`@demo.example.com`) et leurs conversations.
    Refusé en production : cette opération est un outil de recette."""
    if settings.environment == "production":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Purge des données fictives refusée en production"
        )
    return await demo.purge(session, db)
