"""Jetons de service : un formulaire du site, n8n ou un autre outil envoie des prospects sans
compte utilisateur. Le jeton n'est affiché qu'une fois ; seule son empreinte (SHA-256) est
conservée. Chaque jeton ne permet QUE la réception de prospects, avec sa campagne/source fixée.
"""

import hashlib
import secrets
import time
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

COLLECTION = "service_tokens"
PREFIX = "iag_"
RATE_PER_MINUTE = 60
_hits: dict[str, list[float]] = {}


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create(db: Any, data: dict[str, Any], actor_id: int | None) -> tuple[dict[str, Any], str]:
    token = PREFIX + secrets.token_urlsafe(32)
    doc = {
        "_id": uuid4().hex,
        "name": data["name"].strip(),
        "hint": token[:10] + "…",
        "hash": _digest(token),
        "channel": data.get("channel") or "web_form",
        "campaign_id": data.get("campaign_id"),
        "source_id": data.get("source_id"),
        "target_code": data.get("target_code"),
        "created_by": actor_id,
        "created_at": datetime.now(UTC),
        "last_used_at": None,
        "revoked_at": None,
    }
    await db[COLLECTION].insert_one(doc)
    return doc, token


async def list_tokens(db: Any) -> list[dict[str, Any]]:
    return [dict(d) async for d in db[COLLECTION].find({}).sort("created_at", -1)]


async def revoke(db: Any, token_id: str) -> bool:
    result = await db[COLLECTION].update_one(
        {"_id": token_id, "revoked_at": None}, {"$set": {"revoked_at": datetime.now(UTC)}}
    )
    return bool(result.modified_count)


async def authenticate(db: Any, token: str) -> dict[str, Any] | None:
    if not token.startswith(PREFIX):
        return None
    doc = await db[COLLECTION].find_one({"hash": _digest(token), "revoked_at": None})
    if doc is None:
        return None
    await db[COLLECTION].update_one(
        {"_id": doc["_id"]}, {"$set": {"last_used_at": datetime.now(UTC)}}
    )
    return dict(doc)


def allow(token_id: str, now: float | None = None) -> bool:
    """Limite simple par jeton (60 envois par minute) contre les abus d'un formulaire public."""
    moment = now if now is not None else time.monotonic()
    recent = [t for t in _hits.get(token_id, []) if moment - t < 60]
    if len(recent) >= RATE_PER_MINUTE:
        _hits[token_id] = recent
        return False
    recent.append(moment)
    _hits[token_id] = recent
    return True
