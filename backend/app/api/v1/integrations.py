from typing import Any

from fastapi import APIRouter, HTTPException, Response, status

from app.agents import auto
from app.api.dependencies import (
    ADMIN_ONLY,
    CurrentUser,
    EmailDep,
    MongoDb,
    SessionFactoryDep,
    SettingsDep,
)
from app.config import Settings
from app.integrations.email import autoconfig
from app.integrations.email.base import EmailError
from app.integrations.email.factory import has_credentials
from app.integrations.email.imap_smtp import ImapSmtpClient
from app.schemas.integrations import (
    EmailAutodetect,
    EmailAutodetectIn,
    EmailCheck,
    EmailConfigRead,
    EmailConfigWrite,
    EmailFolder,
    EmailStatus,
    EmailSyncResult,
    EmailTestResult,
)
from app.services import email_config, email_sync

router = APIRouter(prefix="/integrations", tags=["integrations"], dependencies=[ADMIN_ONLY])

_NOT_CONFIGURED = "Boîte email non configurée : renseignez-la dans Intégrations > Messagerie."


@router.get("/email", response_model=EmailStatus)
async def email_status(settings: SettingsDep, db: MongoDb) -> EmailStatus:
    effective = await email_config.effective_settings(db, settings)
    state = await email_sync.get_state(db)
    return EmailStatus(
        configured=has_credentials(effective),
        enabled=effective.email_enabled,
        send_enabled=effective.email_send_enabled,
        sender=effective.email_sender_address or None,
        imap_host=effective.email_imap_host,
        smtp_host=effective.email_smtp_host,
        sandbox_recipients=effective.email_sandbox_list,
        outbox=await email_sync.outbox_counts(db),
        **state,
    )


@router.get("/email/config", response_model=EmailConfigRead)
async def get_email_config(settings: SettingsDep, db: MongoDb) -> EmailConfigRead:
    """Configuration de la boîte (sans le mot de passe). Sans saisie dans la console : `.env`."""
    doc = await email_config.load(db)
    if doc:
        return EmailConfigRead(source="console", password_set=bool(doc.get("password_enc")), **doc)
    s = settings
    return EmailConfigRead(
        source="env",
        password_set=bool(s.email_password),
        address=s.email_sender_address,
        username=s.email_username or None,
        imap_host=s.email_imap_host,
        imap_port=s.email_imap_port,
        imap_folder=s.email_imap_folder,
        smtp_host=s.email_smtp_host,
        smtp_port=s.email_smtp_port,
        smtp_security=s.email_smtp_security,
        from_name=s.email_from_name,
        enabled=s.email_enabled,
        send_enabled=s.email_send_enabled,
        sandbox_recipients=s.email_sandbox_list,
    )


@router.put("/email/config", response_model=EmailConfigRead)
async def put_email_config(
    payload: EmailConfigWrite, settings: SettingsDep, db: MongoDb, user: CurrentUser
) -> EmailConfigRead:
    """Enregistre la boîte. Effet au prochain passage de la relève, sans redémarrage."""
    data = _plain(payload)
    existing = await email_config.load(db)
    if not data.get("password") and not (existing and existing.get("password_enc")):
        raise HTTPException(422, detail="Mot de passe requis")
    doc = await email_config.save(db, settings, data, user.id)
    return EmailConfigRead(source="console", password_set=True, **doc)


@router.delete("/email/config", status_code=status.HTTP_204_NO_CONTENT)
async def delete_email_config(db: MongoDb) -> Response:
    """Oublie la boîte saisie dans la console (retour aux valeurs du `.env`)."""
    await email_config.delete(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/email/autodetect", response_model=EmailAutodetect)
async def autodetect(payload: EmailAutodetectIn) -> EmailAutodetect:
    """Propose les serveurs IMAP/SMTP de l'adresse (fournisseur, MX, base Thunderbird)."""
    found = await autoconfig.detect(str(payload.address))
    return EmailAutodetect(**found.__dict__)


@router.post("/email/test", response_model=EmailTestResult)
async def test_email_config(
    payload: EmailConfigWrite, settings: SettingsDep, db: MongoDb
) -> EmailTestResult:
    """Teste les paramètres SAISIS (même non enregistrés) et liste les dossiers. Rien n'est lu,
    rien n'est envoyé. Mot de passe vide : celui déjà enregistré."""
    data = _plain(payload)
    existing = await email_config.load(db)
    candidate = email_config.apply(
        settings, email_config.to_document(settings, data, existing, None)
    )
    if not candidate.email_password:
        raise HTTPException(422, detail="Mot de passe requis")
    client = ImapSmtpClient(candidate)
    result = await client.check()
    folders: list[EmailFolder] = []
    if result.get("imap") == "ok":
        try:
            folders = [EmailFolder(name=n, label=lbl) for n, lbl in await client.folders()]
        except EmailError as exc:
            result["imap"] = str(exc)
    return EmailTestResult(imap=result["imap"], smtp=result["smtp"], folders=folders)


@router.post("/email/check", response_model=EmailCheck)
async def email_check(client: EmailDep) -> EmailCheck:
    """Teste la connexion IMAP et SMTP enregistrée (sans rien lire ni envoyer)."""
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
    effective = await email_config.effective_settings(db, settings)
    try:
        report = await auto.email_cycle(effective, client, db=db, session_factory=session_factory)
    except EmailError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return EmailSyncResult(report=report.as_dict())


def _plain(payload: EmailConfigWrite) -> dict[str, Any]:
    data = payload.model_dump()
    data["address"] = str(payload.address)
    data["sandbox_recipients"] = [str(a) for a in payload.sandbox_recipients]
    data["password"] = payload.password.get_secret_value() if payload.password else None
    return data


__all__ = ["Settings", "router"]
