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
        from app.devtools.commands import guard_not_production

        guard_not_production()  # ignorer la fenêtre d'envoi est un outil d'essai
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


async def cmd_email(*, sync: bool) -> int:
    """`email-check` (test de connexion) et `email-sync` (un passage réception + envoi)."""
    from app.integrations.email.factory import create_email_client

    settings = get_settings()
    client = create_email_client(settings, require_enabled=False)
    if client is None:
        print("Boîte email non configurée : renseignez EMAIL_USERNAME et EMAIL_PASSWORD (.env).")
        return 1
    try:
        if not sync:
            result = await client.check()
            for name, status in result.items():
                print(f"{name.upper()} : {status}")
            return 0 if all(v == "ok" for v in result.values()) else 1
        report = await auto.email_cycle(
            settings,
            client,
            db=get_mongo_db(),
            session_factory=lambda: get_sessionmaker()(),
        )
        print(report.as_dict())
        return 0
    finally:
        await dispose_engine()
        await close_clients()
