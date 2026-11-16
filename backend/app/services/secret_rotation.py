"""Rechiffrement des identifiants des connecteurs avec la clé courante (AUDIT-SEC-007).

Parcourt les documents MongoDB qui portent des secrets chiffrés : réglages de la console
(`settings` : champs `*_enc` et `secrets`) et connexions OAuth des conseillers (Google, Zoom).
"""

from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.core import vault
from app.services import calendar_config, runtime_settings, zoom_config

COLLECTIONS = (runtime_settings.COLLECTION, calendar_config.CONNECTIONS, zoom_config.CONNECTIONS)


@dataclass
class RotationReport:
    rotated: int = 0
    unreadable: int = 0


def _rotate_value(settings: Settings, value: Any, report: RotationReport) -> Any:
    if not isinstance(value, str) or not value:
        return value
    try:
        rotated = vault.rotate(settings, value)
    except vault.VaultError:
        report.unreadable += 1
        return value
    report.rotated += 1
    return rotated


async def rotate_all(db: Any, settings: Settings) -> RotationReport:
    report = RotationReport()
    for name in COLLECTIONS:
        async for doc in db[name].find({}):
            changes: dict[str, Any] = {}
            for key, value in doc.items():
                if key.endswith("_enc"):
                    changes[key] = _rotate_value(settings, value, report)
            if isinstance(doc.get("secrets"), dict):
                changes["secrets"] = {
                    key: _rotate_value(settings, value, report)
                    for key, value in doc["secrets"].items()
                }
            if changes:
                await db[name].update_one({"_id": doc["_id"]}, {"$set": changes})
    return report
