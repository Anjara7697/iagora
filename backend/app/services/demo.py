"""Données de démonstration et du simulateur : prospects fictifs en `@demo.example.com`.

Le domaine est réservé (jamais livrable) : c'est la marque de reconnaissance des données fictives.
La purge ne touche QUE ces prospects (et leurs conversations / décisions de l'agent).
"""

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.demo import DEMO_DOMAIN, DEMO_SUFFIX, is_demo_email
from app.database.collections import AGENT_EVENTS, AGENT_RUNS, CONVERSATIONS
from app.models import Prospect

__all__ = ["DEMO_DOMAIN", "demo_filter", "is_demo_email"]
_SUFFIX = DEMO_SUFFIX


def demo_filter() -> Any:
    # `_` et `%` n'apparaissent pas dans le domaine : le motif est exact.
    return func.lower(func.coalesce(Prospect.email, "")).like(f"%{_SUFFIX}")


async def demo_prospect_ids(session: AsyncSession) -> list[int]:
    return list(await session.scalars(select(Prospect.id).where(demo_filter())))


async def summary(session: AsyncSession, db: Any) -> dict[str, int]:
    ids = await demo_prospect_ids(session)
    conversations = (
        await db[CONVERSATIONS].count_documents({"prospect_id": {"$in": ids}}) if ids else 0
    )
    return {"prospects": len(ids), "conversations": conversations}


async def purge(session: AsyncSession, db: Any) -> dict[str, int]:
    """Supprime les prospects fictifs, leurs conversations et les décisions de l'agent."""
    ids = await demo_prospect_ids(session)
    if not ids:
        return {"prospects": 0, "conversations": 0}
    deleted = await db[CONVERSATIONS].delete_many({"prospect_id": {"$in": ids}})
    await db[AGENT_RUNS].delete_many({"prospect_id": {"$in": ids}})
    await db[AGENT_EVENTS].delete_many({"prospect_id": {"$in": ids}})
    await session.execute(delete(Prospect).where(Prospect.id.in_(ids)))
    await session.commit()
    return {"prospects": len(ids), "conversations": deleted.deleted_count}


async def purge_prospect(session: AsyncSession, db: Any, email: str) -> dict[str, int]:
    """Supprime UN prospect de test (par email) avec toutes ses données : conversations (donc les
    marqueurs d'idempotence des emails reçus), décisions de l'agent, rendez-vous, relances,
    consentements. Le même email peut ensuite refaire le parcours depuis zéro."""
    ids = list(
        await session.scalars(
            select(Prospect.id).where(
                func.lower(func.coalesce(Prospect.email, "")) == email.lower()
            )
        )
    )
    if not ids:
        return {"prospects": 0, "conversations": 0}
    deleted = await db[CONVERSATIONS].delete_many({"prospect_id": {"$in": ids}})
    await db[AGENT_RUNS].delete_many({"prospect_id": {"$in": ids}})
    await db[AGENT_EVENTS].delete_many({"prospect_id": {"$in": ids}})
    await session.execute(delete(Prospect).where(Prospect.id.in_(ids)))
    await session.commit()
    return {"prospects": len(ids), "conversations": deleted.deleted_count}
