"""Données de démonstration et du simulateur : prospects fictifs en `@demo.example.com`.

Le domaine est réservé (jamais livrable) : c'est la marque de reconnaissance des données fictives.
La purge ne touche QUE ces prospects (et leurs conversations / décisions de l'agent).
"""

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Prospect

DEMO_DOMAIN = "demo.example.com"
_SUFFIX = f"@{DEMO_DOMAIN}"


def is_demo_email(email: str | None) -> bool:
    return bool(email) and str(email).strip().lower().endswith(_SUFFIX)


def demo_filter() -> Any:
    # `_` et `%` n'apparaissent pas dans le domaine : le motif est exact.
    return func.lower(func.coalesce(Prospect.email, "")).like(f"%{_SUFFIX}")


async def demo_prospect_ids(session: AsyncSession) -> list[int]:
    return list(await session.scalars(select(Prospect.id).where(demo_filter())))


async def summary(session: AsyncSession, db: Any) -> dict[str, int]:
    ids = await demo_prospect_ids(session)
    conversations = (
        await db["conversations"].count_documents({"prospect_id": {"$in": ids}}) if ids else 0
    )
    return {"prospects": len(ids), "conversations": conversations}


async def purge(session: AsyncSession, db: Any) -> dict[str, int]:
    """Supprime les prospects fictifs, leurs conversations et les décisions de l'agent."""
    ids = await demo_prospect_ids(session)
    if not ids:
        return {"prospects": 0, "conversations": 0}
    deleted = await db["conversations"].delete_many({"prospect_id": {"$in": ids}})
    await db["agent_runs"].delete_many({"prospect_id": {"$in": ids}})
    await session.execute(delete(Prospect).where(Prospect.id.in_(ids)))
    await session.commit()
    return {"prospects": len(ids), "conversations": deleted.deleted_count}
