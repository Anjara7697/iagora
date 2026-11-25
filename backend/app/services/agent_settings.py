"""Réglage global de l'agent : mode de fonctionnement et arrêt d'urgence (stocké dans MongoDB).

- `assisted` (défaut) : l'agent rédige des brouillons ; rien n'est considéré comme prêt à partir
  avant la validation d'un conseiller (seul l'accusé de transfert, texte fixe, est direct) ;
- `auto` : les réponses de l'agent sont enregistrées directement (sans validation) ;
- `manual` : arrêt d'urgence, l'agent ne traite plus aucun message et ses emails en attente
  restent suspendus, même validés ; les conseillers peuvent toujours répondre manuellement.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from app.config import get_settings
from app.core.agent_mode import DEFAULT_MODE, AgentMode

COLLECTION = "settings"
_KEY = "agent_mode"


__all__ = ["DEFAULT_MODE", "AgentMode", "AgentSetting", "CampaignModes", "MessageKind"]


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


# --- Autonomie par campagne et par type de message (D-51) -------------------------------------
#
# Le réglage global reste le défaut de toutes les campagnes. Une campagne peut le remplacer pour
# un type de message : premiers contacts, réponses aux prospects, relances. Deux règles priment
# toujours sur la campagne : l'arrêt d'urgence global (`manual`) arrête tout, et le mode
# automatique reste refusé en production pendant le pilote (D-16), même réglé sur une campagne.
# Les messages à texte fixe (accusé de transfert, rappel de rendez-vous) ne dépendent que du
# réglage global.

CAMPAIGN_COLLECTION = "campaign_agent_modes"


class MessageKind(StrEnum):
    FIRST_CONTACT = "first_contact"
    REPLY = "reply"
    FOLLOW_UP = "follow_up"


KINDS = tuple(MessageKind)


@dataclass(frozen=True)
class CampaignModes:
    campaign_id: int
    overrides: dict[MessageKind, AgentMode]
    updated_by: int | None = None
    updated_at: datetime | None = None


def kind_of_trigger(trigger: str) -> MessageKind:
    if trigger == "first_contact":
        return MessageKind.FIRST_CONTACT
    if trigger == "follow_up":
        return MessageKind.FOLLOW_UP
    return MessageKind.REPLY


def kind_of_message(metadata: dict[str, Any] | None) -> MessageKind:
    metadata = metadata or {}
    if metadata.get("first_contact"):
        return MessageKind.FIRST_CONTACT
    if metadata.get("follow_up"):
        return MessageKind.FOLLOW_UP
    return MessageKind.REPLY


def _overrides(doc: dict[str, Any] | None) -> dict[MessageKind, AgentMode]:
    result: dict[MessageKind, AgentMode] = {}
    for key, value in ((doc or {}).get("modes") or {}).items():
        try:
            result[MessageKind(key)] = AgentMode(value)
        except ValueError:
            continue  # valeur inconnue : la campagne suit le réglage global pour ce type
    return result


async def get_campaign_modes(db: Any, campaign_id: int) -> CampaignModes:
    doc = await db[CAMPAIGN_COLLECTION].find_one({"_id": campaign_id})
    return CampaignModes(
        campaign_id,
        _overrides(doc),
        (doc or {}).get("updated_by"),
        (doc or {}).get("updated_at"),
    )


async def set_campaign_modes(
    db: Any, campaign_id: int, overrides: dict[MessageKind, AgentMode], actor_id: int | None
) -> CampaignModes:
    now = datetime.now(UTC)
    await db[CAMPAIGN_COLLECTION].update_one(
        {"_id": campaign_id},
        {
            "$set": {
                "modes": {k.value: v.value for k, v in overrides.items()},
                "updated_by": actor_id,
                "updated_at": now,
            }
        },
        upsert=True,
    )
    return CampaignModes(campaign_id, dict(overrides), actor_id, now)


def resolve(global_mode: AgentMode, override: AgentMode | None) -> AgentMode:
    """Mode appliqué : l'arrêt d'urgence global prime, puis la campagne, puis le global ; le mode
    automatique retombe sur le mode assisté là où il est refusé (production, D-16)."""
    if global_mode is AgentMode.MANUAL:
        return AgentMode.MANUAL
    mode = override or global_mode
    if mode is AgentMode.AUTO and not auto_mode_allowed():
        return AgentMode.ASSISTED
    return mode


async def effective_modes(db: Any, campaign_id: int | None) -> dict[MessageKind, AgentMode]:
    global_mode = await get_mode(db)
    overrides = (await get_campaign_modes(db, campaign_id)).overrides if campaign_id else {}
    return {kind: resolve(global_mode, overrides.get(kind)) for kind in KINDS}


async def campaign_mode(db: Any, campaign_id: int | None, kind: MessageKind) -> AgentMode:
    return (await effective_modes(db, campaign_id))[kind]


async def prospect_mode(session: Any, db: Any, prospect_id: int, kind: MessageKind) -> AgentMode:
    """Mode appliqué à un message de ce prospect : celui de sa campagne actuelle (son dernier
    rattachement), sinon le réglage global."""
    from app.services import commercial_context

    campaign_id = (await commercial_context.campaign_ids(session, [prospect_id])).get(prospect_id)
    return await campaign_mode(db, campaign_id, kind)


async def campaigns_paused_for(db: Any, kind: MessageKind) -> set[int]:
    """Campagnes où l'agent est arrêté pour ce type de message (le global n'étant pas arrêté)."""
    return {
        int(doc["_id"])
        async for doc in db[CAMPAIGN_COLLECTION].find(
            {f"modes.{kind.value}": AgentMode.MANUAL.value}
        )
    }
