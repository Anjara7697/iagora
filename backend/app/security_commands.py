"""Commande `python -m app.cli rotate-connector-secrets` (AUDIT-SEC-007).

À lancer une fois `CONNECTORS_SECRET_KEY` défini (ou changé, l'ancienne clé dérivée du secret JWT
restant connue) : chaque identifiant de connecteur est rechiffré avec la clé courante. Rien n'est
affiché des secrets eux-mêmes. Exécutable en production : outil d'exploitation.
"""

from app.config import get_settings
from app.database.clients import close_clients, get_mongo_db
from app.services import secret_rotation


async def cmd_rotate_connector_secrets() -> int:
    settings = get_settings()
    if not (settings.connectors_secret_key and settings.connectors_secret_key.get_secret_value()):
        print("CONNECTORS_SECRET_KEY n'est pas défini : rien à rechiffrer.")
        return 1
    try:
        report = await secret_rotation.rotate_all(get_mongo_db(), settings)
    finally:
        await close_clients()
    print(f"{report.rotated} identifiant(s) rechiffré(s) avec CONNECTORS_SECRET_KEY.")
    if report.unreadable:
        print(
            f"{report.unreadable} identifiant(s) illisible(s) avec les clés connues : "
            "à ressaisir dans la console."
        )
        return 2
    return 0
