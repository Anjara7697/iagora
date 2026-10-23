"""Zoom configuré depuis la console : compte Zoom de l'école ou compte de chaque conseiller.

- Réglage (administrateur) : document `connector_zoom` de `settings` :
  `none` (pas de lien de visioconférence), `account` (application Server-to-Server OAuth du
  compte de l'école : réunions créées au nom du conseiller s'il a un compte Zoom dans l'école,
  sinon de l'hôte par défaut), `advisor` (chaque conseiller connecte son propre Zoom).
  Sans réglage dans la console : variables ZOOM_* du `.env`.
- Connexions des conseillers : collection `zoom_connections` (jetons chiffrés).
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.core import vault

SETTINGS = "settings"
KEY = "connector_zoom"
CONNECTIONS = "zoom_connections"
STATE_PURPOSE = "zoom_oauth"


@dataclass(frozen=True)
class ZoomSetup:
    mode: str  # none | account | advisor
    source: str  # console | env
    account_id: str
    client_id: str
    client_secret: str | None
    host_user: str


def _decrypt(settings: Settings, token: str | None) -> str | None:
    if not token:
        return None
    try:
        return vault.decrypt(settings, token)
    except vault.VaultError:
        return None


async def load(db: Any) -> dict[str, Any] | None:
    doc = await db[SETTINGS].find_one({"_id": KEY})
    return dict(doc) if doc else None


async def setup(db: Any, settings: Settings) -> ZoomSetup:
    doc = await load(db)
    if not doc:
        secret = (
            settings.zoom_client_secret.get_secret_value() if settings.zoom_client_secret else None
        )
        configured = bool(settings.zoom_account_id and settings.zoom_client_id and secret)
        return ZoomSetup(
            "account" if configured else "none",
            "env",
            settings.zoom_account_id,
            settings.zoom_client_id,
            secret,
            settings.zoom_host_user,
        )
    return ZoomSetup(
        mode=doc.get("mode", "none"),
        source="console",
        account_id=doc.get("account_id") or "",
        client_id=doc.get("client_id") or "",
        client_secret=_decrypt(settings, doc.get("client_secret_enc")),
        host_user=doc.get("host_user") or "me",
    )


async def save(db: Any, settings: Settings, data: dict[str, Any], actor_id: int | None) -> None:
    existing = await load(db) or {}
    doc: dict[str, Any] = {
        "mode": data["mode"],
        "account_id": (data.get("account_id") or "").strip(),
        "client_id": (data.get("client_id") or "").strip(),
        "host_user": (data.get("host_user") or "me").strip(),
        "updated_by": actor_id,
        "updated_at": datetime.now(UTC),
    }
    if data.get("client_secret"):
        doc["client_secret_enc"] = vault.encrypt(settings, data["client_secret"])
    elif existing.get("client_secret_enc") and existing.get("client_id") == doc["client_id"]:
        doc["client_secret_enc"] = existing["client_secret_enc"]
    await db[SETTINGS].replace_one({"_id": KEY}, {"_id": KEY, **doc}, upsert=True)


async def get_connection(db: Any, user_id: int) -> dict[str, Any] | None:
    doc = await db[CONNECTIONS].find_one({"_id": user_id})
    return dict(doc) if doc else None


async def list_connections(db: Any) -> list[dict[str, Any]]:
    return [dict(d) async for d in db[CONNECTIONS].find({})]


async def save_connection(
    db: Any, settings: Settings, user_id: int, refresh_token: str, account_email: str | None
) -> None:
    await db[CONNECTIONS].replace_one(
        {"_id": user_id},
        {
            "_id": user_id,
            "account_email": account_email,
            "refresh_token_enc": vault.encrypt(settings, refresh_token),
            "connected_at": datetime.now(UTC),
            "last_error": None,
        },
        upsert=True,
    )


async def rotate_refresh_token(db: Any, settings: Settings, user_id: int, token: str) -> None:
    """Zoom remplace le jeton de renouvellement à chaque usage : on garde le nouveau."""
    await db[CONNECTIONS].update_one(
        {"_id": user_id},
        {"$set": {"refresh_token_enc": vault.encrypt(settings, token), "last_error": None}},
    )


async def mark_error(db: Any, user_id: int, error: str) -> None:
    await db[CONNECTIONS].update_one({"_id": user_id}, {"$set": {"last_error": error[:300]}})


async def delete_connection(db: Any, user_id: int) -> dict[str, Any] | None:
    doc = await get_connection(db, user_id)
    await db[CONNECTIONS].delete_one({"_id": user_id})
    return doc


def refresh_token(settings: Settings, connection: dict[str, Any] | None) -> str | None:
    return _decrypt(settings, connection.get("refresh_token_enc")) if connection else None
