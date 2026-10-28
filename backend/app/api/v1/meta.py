import hashlib
import hmac
import json
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)

from app.api.dependencies import (
    ADMIN_ONLY,
    CurrentUser,
    DbSession,
    MongoDb,
    SessionFactoryDep,
    SettingsDep,
)
from app.schemas.meta import (
    MetaConfigRead,
    MetaConfigWrite,
    MetaSimulation,
    MetaSimulationResult,
)
from app.services import meta_config, meta_leads
from app.services import prospects as prospects_service

admin_router = APIRouter(prefix="/integrations/meta", tags=["meta"], dependencies=[ADMIN_ONLY])
webhook_router = APIRouter(prefix="/webhooks/meta", tags=["meta"])


async def _read(db: Any, settings: Any) -> MetaConfigRead:
    doc = await meta_config.load(db) or {}
    setup = await meta_config.setup(db, settings)
    return MetaConfigRead(
        configured=setup.configured,
        enabled=setup.enabled,
        app_id=setup.app_id,
        api_version=setup.api_version,
        app_secret_set=bool(doc.get("app_secret_enc")),
        page_access_token_set=bool(doc.get("page_access_token_enc")),
        verify_token_set=bool(doc.get("verify_token_enc")),
        mappings=setup.mappings,
        **await meta_leads.stats(db),
    )


@admin_router.get("", response_model=MetaConfigRead)
async def get_meta_config(db: MongoDb, settings: SettingsDep) -> MetaConfigRead:
    return await _read(db, settings)


@admin_router.put("", response_model=MetaConfigRead)
async def put_meta_config(
    payload: MetaConfigWrite,
    session: DbSession,
    db: MongoDb,
    settings: SettingsDep,
    user: CurrentUser,
) -> MetaConfigRead:
    for mapping in payload.mappings:
        await prospects_service.check_destination(
            session,
            "web_form",
            mapping.campaign_id,
            mapping.source_id,
            mapping.target_code,
        )
    plain = payload.model_dump()
    for name in ("app_secret", "page_access_token", "verify_token"):
        secret = getattr(payload, name)
        plain[name] = secret.get_secret_value().strip() if secret else None
    await meta_config.save(db, settings, plain, user.id)
    saved = await meta_config.setup(db, settings)
    if saved.enabled and (not saved.configured or not saved.mappings):
        await meta_config.save(db, settings, {**plain, "enabled": False}, user.id)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Renseignez les trois secrets et au moins un formulaire avant d'activer Meta",
        )
    return await _read(db, settings)


@admin_router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meta_config(db: MongoDb) -> Response:
    await meta_config.delete(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.post("/simulate", response_model=MetaSimulationResult)
async def simulate_meta_lead(
    payload: MetaSimulation, session: DbSession, db: MongoDb, settings: SettingsDep
) -> MetaSimulationResult:
    if settings.environment == "production":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Simulation interdite en production")
    try:
        prospect_id, created, duplicate = await meta_leads.simulate(
            session, await meta_config.setup(db, settings), payload
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return MetaSimulationResult(prospect_id=prospect_id, created=created, duplicate=duplicate)


@webhook_router.get("")
async def verify_webhook(
    db: MongoDb,
    settings: SettingsDep,
    mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> Response:
    setup = await meta_config.setup(db, settings)
    if (
        mode != "subscribe"
        or not token
        or not setup.verify_token
        or not hmac.compare_digest(token, setup.verify_token)
        or challenge is None
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Vérification Meta refusée")
    return Response(content=challenge, media_type="text/plain")


@webhook_router.post("")
async def receive_webhook(
    request: Request,
    background: BackgroundTasks,
    db: MongoDb,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
    x_hub_signature_256: Annotated[str | None, Header()] = None,
) -> dict[str, int]:
    setup = await meta_config.setup(db, settings)
    if not setup.enabled or not setup.configured or not setup.app_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Connecteur Meta inactif")
    body = await request.body()
    expected = "sha256=" + hmac.new(setup.app_secret.encode(), body, hashlib.sha256).hexdigest()
    if not x_hub_signature_256 or not hmac.compare_digest(x_hub_signature_256, expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Signature Meta invalide")
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Payload Meta invalide") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Payload Meta invalide")
    if payload.get("object") != "page":
        return {"accepted": 0, "duplicates": 0, "ignored": 1}
    accepted = duplicates = ignored = 0
    for entry in payload.get("entry") or []:
        if not isinstance(entry, dict):
            ignored += 1
            continue
        page_id = str(entry.get("id")) if entry.get("id") is not None else None
        for change in entry.get("changes") or []:
            if not isinstance(change, dict):
                ignored += 1
                continue
            value = change.get("value") or {}
            if not isinstance(value, dict):
                ignored += 1
                continue
            leadgen_id = value.get("leadgen_id")
            form_id = value.get("form_id")
            if change.get("field") != "leadgen" or not leadgen_id or not form_id:
                ignored += 1
                continue
            if await meta_leads.enqueue(db, str(leadgen_id), str(form_id), page_id):
                accepted += 1
                background.add_task(
                    meta_leads.process, db, session_factory, settings, str(leadgen_id)
                )
            else:
                duplicates += 1
    return {"accepted": accepted, "duplicates": duplicates, "ignored": ignored}
