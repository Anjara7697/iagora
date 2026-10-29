"""Configuration Meta Lead Ads saisie dans la console et chiffrée dans MongoDB."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.config import Settings
from app.core import vault

COLLECTION = "settings"
KEY = "connector_meta"


@dataclass(frozen=True)
class MetaSetup:
    app_id: str
    api_version: str
    app_secret: str | None
    page_access_token: str | None
    verify_token: str | None
    enabled: bool
    mappings: list[dict[str, Any]]

    @property
    def configured(self) -> bool:
        return bool(
            self.app_id and self.app_secret and self.page_access_token and self.verify_token
        )


def _decrypt(settings: Settings, encrypted: str | None) -> str | None:
    if not encrypted:
        return None
    try:
        return vault.decrypt(settings, encrypted)
    except vault.VaultError:
        return None


async def load(db: Any) -> dict[str, Any] | None:
    doc = await db[COLLECTION].find_one({"_id": KEY})
    return dict(doc) if doc else None


async def setup(db: Any, settings: Settings) -> MetaSetup:
    doc = await load(db) or {}
    return MetaSetup(
        app_id=(doc.get("app_id") or "").strip(),
        api_version=doc.get("api_version") or "v24.0",
        app_secret=_decrypt(settings, doc.get("app_secret_enc")),
        page_access_token=_decrypt(settings, doc.get("page_access_token_enc")),
        verify_token=_decrypt(settings, doc.get("verify_token_enc")),
        enabled=bool(doc.get("enabled")),
        mappings=list(doc.get("mappings") or []),
    )


async def save(
    db: Any, settings: Settings, data: dict[str, Any], actor_id: int | None
) -> dict[str, Any]:
    existing = await load(db) or {}
    doc: dict[str, Any] = {
        "app_id": (data.get("app_id") or "").strip(),
        "api_version": data.get("api_version") or "v24.0",
        "enabled": bool(data.get("enabled")),
        "mappings": data.get("mappings") or [],
        "updated_by": actor_id,
        "updated_at": datetime.now(UTC),
    }
    for name in ("app_secret", "page_access_token", "verify_token"):
        encrypted = f"{name}_enc"
        if data.get(name):
            doc[encrypted] = vault.encrypt(settings, data[name])
        elif existing.get(encrypted):
            doc[encrypted] = existing[encrypted]
    await db[COLLECTION].replace_one({"_id": KEY}, {"_id": KEY, **doc}, upsert=True)
    return doc


async def delete(db: Any) -> None:
    await db[COLLECTION].delete_one({"_id": KEY})


def mapping_for(setup: MetaSetup, form_id: str) -> dict[str, Any] | None:
    return next(
        (
            mapping
            for mapping in setup.mappings
            if mapping.get("enabled", True) and str(mapping.get("form_id")) == form_id
        ),
        None,
    )
