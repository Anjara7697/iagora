"""Commande `python -m app.cli run-follow-ups` : exécute une fois les relances échues.

Utile pour tester sans attendre l'exécuteur de fond (`FOLLOW_UP_WORKER_ENABLED`), ou depuis un
planificateur externe (cron). `--anytime` ignore la fenêtre d'envoi (essais uniquement).
"""

from app.agents import auto
from app.api.dependencies import get_calendar, get_knowledge_base, get_language_model
from app.config import get_settings
from app.database.clients import close_clients, get_mongo_db
from app.database.session import dispose_engine, get_sessionmaker


async def cmd_run_follow_ups(*, anytime: bool) -> None:
    settings = get_settings()
    if anytime:
        settings = settings.model_copy(
            update={
                "follow_up_window_start_hour": 0,
                "follow_up_window_end_hour": 24,
                "follow_up_weekdays_only": False,
            }
        )
    try:
        summary = await auto.run_due_follow_ups(
            lambda: get_sessionmaker()(),
            get_mongo_db(),
            llm=get_language_model(settings),
            calendar=get_calendar(),
            knowledge=get_knowledge_base(settings),
            settings=settings,
        )
    finally:
        await dispose_engine()
        await close_clients()
    if summary.skipped:
        print(f"Aucune relance exécutée : {summary.skipped}.")
    print(f"{summary.executed} relance(s) exécutée(s), {summary.cancelled} annulée(s).")
    for note in summary.notes:
        print(f"  - {note}")
