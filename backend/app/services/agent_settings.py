"""Réglage global de l'agent : mode de fonctionnement et arrêt d'urgence (stocké dans MongoDB).

- `assisted` (défaut) : l'agent rédige des brouillons ; rien n'est considéré comme prêt à partir
  avant la validation d'un conseiller (seul l'accusé de transfert, texte fixe, est direct) ;
- `auto` : les réponses de l'agent sont enregistrées directement (sans validation) ;
- `manual` : arrêt d'urgence, l'agent ne traite plus aucun message et ses emails en attente
  restent suspendus, même validés ; les conseillers peuvent toujours répondre manuellement.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.config import get_settings
from app.core.agent_mode import DEFAULT_MODE, AgentMode

COLLECTION = "settings"
_KEY = "agent_mode"


__all__ = ["DEFAULT_MODE", "AgentMode", "AgentSetting"]


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
    if mode is AgentMode.AUTO and not auto_mode_allowed():
        mode = AgentMode.ASSISTED  # réglage antérieur au passage en production : on reste prudent
    return AgentSetting(mode, doc.get("updated_by"), doc.get("updated_at"))


def auto_mode_allowed() -> bool:
    """Mode automatique refusé en production pendant le pilote (décision D-16)."""
    return get_settings().environment != "production"


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
