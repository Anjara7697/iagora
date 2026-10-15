from fastapi import APIRouter, HTTPException, status

from app.agents import auto
from app.api.dependencies import ADMIN_ONLY, EmailDep, MongoDb, SessionFactoryDep, SettingsDep
from app.integrations.email.base import EmailError
from app.integrations.email.factory import has_credentials
from app.schemas.integrations import EmailCheck, EmailStatus, EmailSyncResult
from app.services import email_sync

router = APIRouter(prefix="/integrations", tags=["integrations"], dependencies=[ADMIN_ONLY])

_NOT_CONFIGURED = "Boîte email non configurée : renseignez EMAIL_USERNAME et EMAIL_PASSWORD."


@router.get("/email", response_model=EmailStatus)
async def email_status(settings: SettingsDep, db: MongoDb) -> EmailStatus:
    state = await email_sync.get_state(db)
    configured = has_credentials(settings)
    return EmailStatus(
        configured=configured,
        enabled=settings.email_enabled,
        send_enabled=settings.email_send_enabled,
        sender=settings.email_sender_address or None,
        imap_host=settings.email_imap_host,
        smtp_host=settings.email_smtp_host,
        sandbox_recipients=settings.email_sandbox_list,
        outbox=await email_sync.outbox_counts(db),
        **state,
    )


@router.post("/email/check", response_model=EmailCheck)
async def email_check(client: EmailDep) -> EmailCheck:
    """Teste la connexion IMAP et SMTP (sans rien lire ni envoyer)."""
    if client is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NOT_CONFIGURED)
    return EmailCheck(**await client.check())


@router.post("/email/sync", response_model=EmailSyncResult)
async def email_run(
    client: EmailDep, settings: SettingsDep, db: MongoDb, session_factory: SessionFactoryDep
) -> EmailSyncResult:
    """Lance un passage immédiat : réception des nouveaux emails, envoi des messages validés."""
    if client is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NOT_CONFIGURED)
    try:
        report = await auto.email_cycle(settings, client, db=db, session_factory=session_factory)
    except EmailError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return EmailSyncResult(report=report.as_dict())
