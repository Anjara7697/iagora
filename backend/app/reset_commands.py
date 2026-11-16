"""Commande `python -m app.cli reset-dev-data` : repartir d'une instance d'essai vide (D-30).

Sans `--apply`, elle ne fait que compter ce qui serait effacé. Avec `--apply`, elle efface les
données métier (voir `services/dev_reset.py`) et garde comptes, réglages, connecteurs et clés.
Refusée en production. Faire une sauvegarde juste avant (`deploy/backup.sh`).
"""

from app.config import get_settings
from app.database.clients import close_clients, get_mongo_db
from app.database.session import dispose_engine, get_sessionmaker
from app.services import dev_reset
from app.services.errors import ConflictError


async def cmd_reset_dev_data(*, apply: bool) -> int:
    settings = get_settings()
    try:
        dev_reset.guard(settings)
    except ConflictError as exc:
        print(exc)
        return 1
    try:
        async with get_sessionmaker()() as session:
            db = get_mongo_db()
            report = (
                await dev_reset.reset(session, db, settings)
                if apply
                else await dev_reset.preview(session, db)
            )
    finally:
        await close_clients()
        await dispose_engine()
    verb = "effacé(s)" if apply else "à effacer"
    for label, count in report.counts.items():
        print(f"  - {label} : {count} {verb}")
    for note in report.detached:
        print(f"  ! {note}")
    if not apply:
        print("Aperçu seulement : relancez avec --apply pour effacer (après une sauvegarde).")
    else:
        print("Données effacées. Comptes, Paramètres, connecteurs et clés sont conservés.")
    return 0
