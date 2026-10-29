"""Commande `python -m app.cli purge-inactive` : durée de conservation des prospects.

Sans `--apply`, elle ne fait que dénombrer (numéros de fiche et dernière activité, jamais de nom ni
d'adresse). Avec `--apply`, chaque prospect inactif est effacé comme par l'action de la console.
Exécutable en production : c'est un outil d'exploitation, pas de recette. La durée est une décision
de DATUM (voir docs/conformite-rgpd.md) : aucune purge ne se lance automatiquement.
"""

from app.database.clients import close_clients, get_mongo_db
from app.database.session import dispose_engine, get_sessionmaker
from app.services import erasure


async def cmd_purge_inactive(days: int, *, include_converted: bool, apply: bool) -> int:
    if days < 30:
        print("Refusé : la durée minimale est de 30 jours.")
        return 1
    try:
        async with get_sessionmaker()() as session:
            inactive = await erasure.inactive_prospects(
                session, older_than_days=days, include_converted=include_converted
            )
            scope = "convertis compris" if include_converted else "hors convertis"
            print(f"{len(inactive)} prospect(s) inactif(s) depuis {days} jours ou plus ({scope}).")
            for item in inactive[:50]:
                print(f"  - fiche {item.prospect_id} : activité {item.last_activity:%Y-%m-%d}")
            if len(inactive) > 50:
                print(f"  … et {len(inactive) - 50} autre(s).")
            if not apply:
                print("Aperçu seulement : relancez avec --apply pour effacer.")
                return 0
            external = 0
            for item in inactive:
                report = await erasure.erase_prospect(
                    session, get_mongo_db(), item.prospect_id, reason="retention", actor_id=None
                )
                external += len(report.external_events)
            print(f"{len(inactive)} prospect(s) effacé(s).")
            if external:
                print(
                    f"{external} rendez-vous existent encore dans Google Agenda / Zoom : "
                    "à supprimer à la main."
                )
    finally:
        await dispose_engine()
        await close_clients()
    return 0
