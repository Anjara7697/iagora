"""Réglages de l'agent modifiables depuis la console (Paramètres), sans `.env` ni redémarrage.

Document `app_settings` de la collection `settings` : il remplace, champ par champ, les valeurs
du `.env` (qui restent la valeur de départ). Les clés d'API sont chiffrées (app.core.vault) et ne
sont jamais renvoyées. Les boucles de fond et l'API relisent ces réglages à chaque usage.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from pydantic import SecretStr

from app.config import Settings
from app.core import vault

logger = logging.getLogger(__name__)
COLLECTION = "settings"
KEY = "app_settings"
SECRETS = ("gemini_api_key", "openai_api_key")
FIELDS = (
    "llm_provider",
    "llm_model",
    "llm_fallback_model",
    "llm_temperature",
    "agent_auto_reply",
    "follow_up_window_start_hour",
    "follow_up_window_end_hour",
    "follow_up_weekdays_only",
    "follow_up_max_per_silence",
    "email_footer",
    "email_ai_notice",
    "email_brand_name",
    "email_brand_color",
    "email_logo_url",
    "email_create_unknown_senders",
    "email_poll_seconds",
    "calendar_timezone",
    "calendar_work_days",
    "calendar_work_start_hour",
    "calendar_work_end_hour",
    "calendar_slot_minutes",
    "calendar_min_notice_hours",
    "calendar_horizon_days",
    "calendar_buffer_minutes",
)


async def load(db: Any) -> dict[str, Any] | None:
    doc = await db[COLLECTION].find_one({"_id": KEY})
    return dict(doc) if doc else None


def apply(base: Settings, doc: dict[str, Any] | None) -> Settings:
    if not doc:
        return base
    update: dict[str, Any] = {k: v for k, v in (doc.get("values") or {}).items() if k in FIELDS}
    for name, token in (doc.get("secrets") or {}).items():
        if name not in SECRETS or not token:
            continue
        try:
            update[name] = SecretStr(vault.decrypt(base, token))
        except vault.VaultError:
            logger.warning("Clé %s illisible : à ressaisir dans Paramètres", name)
    return base.model_copy(update=update)


async def effective(db: Any, base: Settings) -> Settings:
    """Réglages effectifs ; en cas d'indisponibilité de MongoDB, ceux du `.env`."""
    try:
        return apply(base, await load(db))
    except Exception:
        logger.exception("Réglages de la console illisibles : valeurs du .env utilisées")
        return base


def to_document(
    base: Settings, data: dict[str, Any], existing: dict[str, Any] | None, actor_id: int | None
) -> dict[str, Any]:
    secrets = dict((existing or {}).get("secrets") or {})
    for name in SECRETS:
        if data.get(name):
            secrets[name] = vault.encrypt(base, data[name])
    return {
        "values": {k: data[k] for k in FIELDS if k in data},
        "secrets": secrets,
        "updated_by": actor_id,
        "updated_at": datetime.now(UTC),
    }


async def save(db: Any, base: Settings, data: dict[str, Any], actor_id: int | None) -> None:
    doc = to_document(base, data, await load(db), actor_id)
    await db[COLLECTION].replace_one({"_id": KEY}, {"_id": KEY, **doc}, upsert=True)


async def reset(db: Any) -> None:
    await db[COLLECTION].delete_one({"_id": KEY})
