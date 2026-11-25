"""Consignes maison de l'école (D-53), modifiables par un administrateur sans développeur.

Document `house_rules` de la collection `settings` : ton et règles de style en texte libre, et
liste d'expressions interdites, vérifiée par le code dans chaque message de l'agent. Chaque
enregistrement crée une version numérotée, gardée dans `house_rules_history` (les plus récentes
seulement) pour savoir quelles consignes ont produit un message et revenir à une version.

Les consignes passent après les règles absolues de l'agent (prompts.RULES) : elles ne lèvent ni le
vouvoiement, ni la vérification des faits (NF-10), et ne sont jamais une source.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo import DESCENDING, ReturnDocument

from app.graph.ports import HouseRules

COLLECTION = "settings"
KEY = "house_rules"
HISTORY = "house_rules_history"
KEEP_VERSIONS = 20


@dataclass(frozen=True)
class HouseRulesVersion:
    rules: HouseRules
    updated_by: int | None = None
    updated_at: datetime | None = None


def _rules(doc: dict[str, Any] | None) -> HouseRules:
    if not doc:
        return HouseRules()
    banned = tuple(str(p) for p in (doc.get("banned") or []) if str(p).strip())
    return HouseRules(
        style=str(doc.get("style") or ""), banned=banned, version=int(doc.get("version") or 0)
    )


def _version(doc: dict[str, Any] | None) -> HouseRulesVersion:
    return HouseRulesVersion(
        _rules(doc), (doc or {}).get("updated_by"), (doc or {}).get("updated_at")
    )


async def get_rules(db: Any) -> HouseRules:
    """Consignes en vigueur (vides tant qu'aucun administrateur n'en a écrit)."""
    return _rules(await db[COLLECTION].find_one({"_id": KEY}))


async def get_current(db: Any) -> HouseRulesVersion:
    return _version(await db[COLLECTION].find_one({"_id": KEY}))


def clean_banned(banned: list[str]) -> list[str]:
    """Une expression par entrée, espaces resserrés, sans doublon (casse ignorée)."""
    seen: set[str] = set()
    result = []
    for phrase in banned:
        text = " ".join(phrase.split())
        if text and text.casefold() not in seen:
            seen.add(text.casefold())
            result.append(text)
    return result


async def save(db: Any, style: str, banned: list[str], actor_id: int | None) -> HouseRulesVersion:
    """Enregistre une nouvelle version, appliquée dès le prochain message de l'agent."""
    now = datetime.now(UTC)
    values = {
        "style": style.strip(),
        "banned": clean_banned(banned),
        "updated_by": actor_id,
        "updated_at": now,
    }
    doc = await db[COLLECTION].find_one_and_update(
        {"_id": KEY},
        {"$set": values, "$inc": {"version": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    await db[HISTORY].insert_one({**values, "version": doc["version"]})
    # On ne garde que les dernières versions.
    old = db[HISTORY].find({}, {"_id": 1}).sort("version", DESCENDING).skip(KEEP_VERSIONS)
    stale = [d["_id"] async for d in old]
    if stale:
        await db[HISTORY].delete_many({"_id": {"$in": stale}})
    return _version(doc)


async def history(db: Any) -> list[HouseRulesVersion]:
    cursor = db[HISTORY].find({}).sort("version", DESCENDING).limit(KEEP_VERSIONS)
    return [_version(d) async for d in cursor]
