"""Agenda configuré depuis la console : mode, application OAuth Google, connexions des conseillers.

- Réglage global (administrateur) : document `connector_calendar` de la collection `settings`
  (mode `none` | `demo` | `google`, identifiant et secret chiffré de l'application OAuth Google,
  conseiller dont l'agenda sert par défaut). Sans réglage dans la console : variables du `.env`.
- Connexion de chaque conseiller : collection `calendar_connections` (jeton de renouvellement
  chiffré, compte Google, état). Rien n'est renvoyé par l'API en clair.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.config import Settings
from app.core import vault

SETTINGS = "settings"
KEY = "connector_calendar"
CONNECTIONS = "calendar_connections"
STATE_PURPOSE = "calendar_oauth"


@dataclass(frozen=True)
class CalendarSetup:
    provider: str  # none | demo | google
    source: str  # console | env
    client_id: str
    client_secret: str | None
    default_user_id: int | None


async def load(db: Any) -> dict[str, Any] | None:
    doc = await db[SETTINGS].find_one({"_id": KEY})
    return dict(doc) if doc else None


async def setup(db: Any, settings: Settings) -> CalendarSetup:
    doc = await load(db)
    if not doc:
        return CalendarSetup(settings.calendar_provider, "env", "", None, None)
    secret = None
    if doc.get("client_secret_enc"):
        try:
            secret = vault.decrypt(settings, doc["client_secret_enc"])
        except vault.VaultError:
            secret = None
    return CalendarSetup(
        provider=doc.get("provider", "none"),
        source="console",
        client_id=doc.get("google_client_id") or "",
        client_secret=secret,
        default_user_id=doc.get("default_user_id"),
    )


async def save(db: Any, settings: Settings, data: dict[str, Any], actor_id: int | None) -> None:
    existing = await load(db) or {}
    doc: dict[str, Any] = {
        "provider": data["provider"],
        "google_client_id": (data.get("google_client_id") or "").strip(),
        "default_user_id": data.get("default_user_id"),
        "updated_by": actor_id,
        "updated_at": datetime.now(UTC),
    }
    secret = data.get("google_client_secret")
    if secret:
        doc["client_secret_enc"] = vault.encrypt(settings, secret)
    elif existing.get("client_secret_enc"):
        doc["client_secret_enc"] = existing["client_secret_enc"]
    await db[SETTINGS].replace_one({"_id": KEY}, {"_id": KEY, **doc}, upsert=True)


# --- Connexions des conseillers ----------------------------------------------------------------


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
            "provider": "google",
            "account_email": account_email,
            "refresh_token_enc": vault.encrypt(settings, refresh_token),
            "connected_at": datetime.now(UTC),
            "last_error": None,
        },
        upsert=True,
    )


async def mark_error(db: Any, user_id: int, error: str) -> None:
    await db[CONNECTIONS].update_one({"_id": user_id}, {"$set": {"last_error": error[:300]}})


async def delete_connection(db: Any, user_id: int) -> dict[str, Any] | None:
    doc = await get_connection(db, user_id)
    await db[CONNECTIONS].delete_one({"_id": user_id})
    return doc


def refresh_token(settings: Settings, connection: dict[str, Any]) -> str | None:
    try:
        return vault.decrypt(settings, connection["refresh_token_enc"])
    except (vault.VaultError, KeyError):
        return None


# --- État signé du parcours OAuth ---------------------------------------------------------------


def make_state(settings: Settings, user_id: int, return_to: str) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "purpose": STATE_PURPOSE,
        "ret": return_to,
        "iat": now,
        "exp": now + timedelta(minutes=10),
    }
    return jwt.encode(claims, settings.jwt_secret_key.get_secret_value(), algorithm="HS256")


def read_state(settings: Settings, state: str) -> tuple[int, str] | None:
    try:
        claims = jwt.decode(state, settings.jwt_secret_key.get_secret_value(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if claims.get("purpose") != STATE_PURPOSE:
        return None
    return int(claims["sub"]), str(claims.get("ret") or "")
