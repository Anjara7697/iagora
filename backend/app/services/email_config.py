"""Configuration de la boîte email saisie dans la console (Intégrations), stockée dans MongoDB.

Elle remplace les variables EMAIL_* du `.env` dès qu'elle existe (le `.env` reste une valeur de
départ). Le mot de passe est chiffré (app.core.vault) et n'est jamais renvoyé par l'API. Les
changements s'appliquent au passage suivant de la boucle email, sans redémarrage.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from pydantic import SecretStr

from app.config import Settings
from app.core import vault

logger = logging.getLogger(__name__)
COLLECTION = "settings"
KEY = "connector_email"


async def load(db: Any) -> dict[str, Any] | None:
    doc = await db[COLLECTION].find_one({"_id": KEY})
    return dict(doc) if doc else None


def apply(base: Settings, doc: dict[str, Any] | None) -> Settings:
    """Settings effectifs : la configuration de la console l'emporte sur le `.env`."""
    if not doc:
        return base
    password: SecretStr | None = None
    if doc.get("password_enc"):
        try:
            password = SecretStr(vault.decrypt(base, doc["password_enc"]))
        except vault.VaultError:
            logger.warning("Mot de passe de la boîte email illisible : à ressaisir")
    return base.model_copy(
        update={
            "email_username": doc.get("username") or doc["address"],
            "email_password": password,
            "email_from_address": doc["address"],
            "email_from_name": doc.get("from_name") or base.email_from_name,
            "email_imap_host": doc["imap_host"],
            "email_imap_port": doc["imap_port"],
            "email_imap_folder": doc.get("imap_folder") or "INBOX",
            "email_smtp_host": doc["smtp_host"],
            "email_smtp_port": doc["smtp_port"],
            "email_smtp_security": doc["smtp_security"],
            "email_enabled": bool(doc.get("enabled")),
            "email_send_enabled": bool(doc.get("send_enabled")),
            "email_sandbox_recipients": ",".join(doc.get("sandbox_recipients") or []),
        }
    )


async def effective_settings(db: Any, base: Settings) -> Settings:
    return apply(base, await load(db))


def to_document(
    base: Settings, data: dict[str, Any], existing: dict[str, Any] | None, actor_id: int | None
) -> dict[str, Any]:
    """Document à enregistrer. Mot de passe vide = on garde celui déjà enregistré."""
    password = data.pop("password", None)
    doc = dict(data)
    doc["address"] = str(doc["address"]).lower()
    doc["username"] = (doc.get("username") or "").strip() or doc["address"]
    doc["sandbox_recipients"] = [str(a).lower() for a in doc.get("sandbox_recipients") or []]
    if password:
        doc["password_enc"] = vault.encrypt(base, password)
    elif existing and existing.get("password_enc"):
        doc["password_enc"] = existing["password_enc"]
    doc["updated_by"] = actor_id
    doc["updated_at"] = datetime.now(UTC)
    return doc


async def save(
    db: Any, base: Settings, data: dict[str, Any], actor_id: int | None
) -> dict[str, Any]:
    doc = to_document(base, data, await load(db), actor_id)
    await db[COLLECTION].replace_one({"_id": KEY}, {"_id": KEY, **doc}, upsert=True)
    return doc


async def delete(db: Any) -> None:
    await db[COLLECTION].delete_one({"_id": KEY})
