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
    from app.services import email_config

    settings = await email_config.effective_settings(get_mongo_db(), get_settings())
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


async def cmd_calendar_check(advisor_email: str | None) -> int:
    """`calendar-check` : créneaux de l'agenda tel que l'agent le voit (console, à défaut .env),
    pour un conseiller donné. Rien n'est réservé."""
    from sqlalchemy import func, select

    from app.graph.ports import CalendarError
    from app.models import User
    from app.services.agenda import ConsoleCalendar

    advisor_id = None
    if advisor_email:
        async with get_sessionmaker()() as session:
            advisor_id = await session.scalar(
                select(User.id).where(func.lower(User.email) == advisor_email.lower())
            )
        if advisor_id is None:
            print(f"Aucun membre de l'équipe avec l'email {advisor_email}.")
            return 1
    calendar = ConsoleCalendar(get_settings(), get_mongo_db)
    try:
        slots = await calendar.get_available_slots(
            3, advisor_email=advisor_email, advisor_id=advisor_id
        )
    except CalendarError as exc:
        print(f"Agenda : {exc}")
        return 1
    finally:
        await dispose_engine()
    print(f"Agenda : ok, {len(slots)} créneau(x) libre(s)")
    for slot in slots:
        print(f"  {slot.start.isoformat()}")
    return 0


async def cmd_reset_prospect(email: str, *, unread: bool) -> int:
    """`reset-prospect` : repartir de zéro pour UNE adresse de test, sans toucher au reste.

    Outil de recette : jamais en production, et uniquement pour une adresse fictive
    (@demo.example.com) ou déclarée dans EMAIL_SANDBOX_RECIPIENTS (adresses de test)."""
    from app.integrations.email.factory import create_email_client
    from app.integrations.email.imap_smtp import ImapSmtpClient
    from app.services import demo, email_config

    settings = await email_config.effective_settings(get_mongo_db(), get_settings())
    address = email.strip().lower()
    if settings.environment == "production":
        print("Refusé : outil de recette, interdit en production.")
        return 1
    if not (demo.is_demo_email(address) or address in settings.email_sandbox_list):
        print(
            f"Refusé : {address} n'est ni une adresse fictive (@{demo.DEMO_DOMAIN}) ni dans "
            "EMAIL_SANDBOX_RECIPIENTS. Seules les adresses de test peuvent être effacées."
        )
        return 1
    try:
        async with get_sessionmaker()() as session:
            result = await demo.purge_prospect(session, get_mongo_db(), address)
        print(
            f"{result['prospects']} prospect(s) et {result['conversations']} "
            "conversation(s) supprimé(s)."
        )
        if unread:
            client = create_email_client(settings, require_enabled=False)
            if not isinstance(client, ImapSmtpClient):
                print("Boîte email non configurée : emails non remis en non lu.")
                return 1
            count = await client.mark_unseen_from(address)
            print(
                f"{count} email(s) de {address} remis en non lu dans {settings.email_imap_folder}."
            )
    finally:
        await dispose_engine()
    return 0
