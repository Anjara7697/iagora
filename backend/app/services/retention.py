"""Durées de conservation appliquées par MongoDB (AUDIT-DATA-003, décision D-18).

- décisions de l'agent (`agent_runs`) : supprimées `AGENT_RUNS_RETENTION_DAYS` jours après
  leur début ;
- entrées terminées de la file de l'agent (`agent_events`) : `AGENT_EVENTS_RETENTION_DAYS`
  jours après leur fin.

Index TTL : MongoDB supprime les documents lui-même (environ une passe par minute). Une durée
modifiée dans la configuration est appliquée au démarrage suivant (`collMod`), sans recréer
l'index. La purge des prospects inactifs (3 ans, D-17) reste la commande `purge-inactive`,
planifiée sur le serveur.
"""

from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.database.collections import AGENT_EVENTS, AGENT_RUNS

DAY = 86_400


async def _ensure_ttl(
    db: Any, collection: str, field: str, days: int, partial: dict[str, Any] | None = None
) -> None:
    name = f"{field}_ttl"
    seconds = days * DAY
    existing = (await db[collection].index_information()).get(name)
    if existing is not None:
        if existing.get("expireAfterSeconds") != seconds:
            await db.command(
                "collMod", collection, index={"name": name, "expireAfterSeconds": seconds}
            )
        return
    options: dict[str, Any] = {"name": name, "expireAfterSeconds": seconds}
    if partial is not None:
        options["partialFilterExpression"] = partial
    await db[collection].create_index(field, **options)


async def ensure_retention(db: Any, settings: Settings) -> None:
    await _ensure_ttl(db, AGENT_RUNS, "started_at", settings.agent_runs_retention_days)
    # Entrées terminées avant cette version : datées maintenant, elles expirent à leur tour.
    await db[AGENT_EVENTS].update_many(
        {"completed": True, "completed_at": {"$exists": False}},
        {"$set": {"completed_at": datetime.now(UTC)}},
    )
    await _ensure_ttl(
        db,
        AGENT_EVENTS,
        "completed_at",
        settings.agent_events_retention_days,
        partial={"completed": True},
    )
