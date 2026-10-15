"""Réglage global de l'agent : mode de fonctionnement et arrêt d'urgence (stocké dans MongoDB).

- `assisted` (défaut) : l'agent rédige des brouillons ; rien n'est considéré comme prêt à partir
  avant la validation d'un conseiller (seul l'accusé de transfert, texte fixe, est direct) ;
- `auto` : les réponses de l'agent sont enregistrées directement (sans validation) ;
- `manual` : arrêt d'urgence, l'agent ne traite plus aucun message ; les conseillers répondent.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

COLLECTION = "settings"
_KEY = "agent_mode"


class AgentMode(StrEnum):
    ASSISTED = "assisted"
    AUTO = "auto"
    MANUAL = "manual"


DEFAULT_MODE = AgentMode.ASSISTED


@dataclass(frozen=True)
class AgentSetting:
    mode: AgentMode
    updated_by: int | None = None
    updated_at: datetime | None = None


async def get_setting(db: Any) -> AgentSetting:
    doc = await db[COLLECTION].find_one({"_id": _KEY})
    if doc is None:
        return AgentSetting(DEFAULT_MODE)
    try:
        mode = AgentMode(doc["value"])
    except ValueError:  # valeur inconnue : on retombe sur le mode prudent
        mode = DEFAULT_MODE
    return AgentSetting(mode, doc.get("updated_by"), doc.get("updated_at"))


async def get_mode(db: Any) -> AgentMode:
    return (await get_setting(db)).mode


async def set_mode(db: Any, mode: AgentMode, actor_id: int | None) -> AgentSetting:
    now = datetime.now(UTC)
    await db[COLLECTION].update_one(
        {"_id": _KEY},
        {"$set": {"value": mode.value, "updated_by": actor_id, "updated_at": now}},
        upsert=True,
    )
    return AgentSetting(mode, actor_id, now)
