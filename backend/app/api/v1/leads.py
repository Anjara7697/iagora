"""Réception de prospects par jeton de service (formulaire du site, n8n…) et gestion des jetons."""

from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Response, status

from app.api.dependencies import (
    ADMIN_ONLY,
    CalendarDep,
    CurrentUser,
    DbSession,
    KnowledgeDep,
    Llm,
    MongoDb,
    SessionFactoryDep,
    SettingsDep,
)
from app.api.v1 import prospects as prospects_api
from app.schemas.leads import (
    LeadAccepted,
    LeadIn,
    ServiceTokenCreate,
    ServiceTokenCreated,
    ServiceTokenRead,
)
from app.schemas.prospect import ProspectIngest
from app.services import prospects as prospects_service
from app.services import service_tokens

admin_router = APIRouter(prefix="/integrations/tokens", tags=["leads"], dependencies=[ADMIN_ONLY])
router = APIRouter(tags=["leads"])


def _read(doc: dict[str, Any]) -> ServiceTokenRead:
    return ServiceTokenRead(id=doc["_id"], **{k: v for k, v in doc.items() if k != "_id"})


@admin_router.get("", response_model=list[ServiceTokenRead])
async def list_tokens(db: MongoDb) -> list[ServiceTokenRead]:
    return [_read(d) for d in await service_tokens.list_tokens(db)]


@admin_router.post("", response_model=ServiceTokenCreated, status_code=status.HTTP_201_CREATED)
async def create_token(
    payload: ServiceTokenCreate, session: DbSession, db: MongoDb, user: CurrentUser
) -> ServiceTokenCreated:
    """Crée un jeton. Il est renvoyé UNE seule fois : seule son empreinte est conservée."""
    await prospects_service.check_destination(
        session, payload.channel, payload.campaign_id, payload.source_id, payload.target_code
    )
    doc, token = await service_tokens.create(db, payload.model_dump(), user.id)
    return ServiceTokenCreated(**_read(doc).model_dump(), token=token)


@admin_router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_token(token_id: str, db: MongoDb) -> Response:
    """Révoque le jeton : effet immédiat, les envois suivants sont refusés (401)."""
    if not await service_tokens.revoke(db, token_id):
        raise HTTPException(404, detail="Jeton introuvable ou déjà révoqué")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/leads", response_model=LeadAccepted, status_code=status.HTTP_201_CREATED)
async def receive_lead(
    lead: LeadIn,
    response: Response,
    background: BackgroundTasks,
    session: DbSession,
    db: MongoDb,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
    authorization: Annotated[str | None, Header()] = None,
    x_api_key: Annotated[str | None, Header()] = None,
) -> LeadAccepted:
    """Reçoit un prospect avec un jeton de service (`Authorization: Bearer iag_…` ou
    `X-API-Key`). Campagne, source et canal sont ceux du jeton. Même traitement qu'une saisie
    dans la console : déduplication, consentement, message transmis à l'agent."""
    raw = x_api_key or (authorization or "").removeprefix("Bearer ").strip()
    token = await service_tokens.authenticate(db, raw) if raw else None
    if token is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Jeton de service invalide ou révoqué",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not service_tokens.allow(token["_id"]):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Trop d'envois : patientez")
    payload = ProspectIngest(
        first_name=lead.first_name,
        last_name=lead.last_name,
        email=lead.email,
        phone=lead.phone,
        channel=token["channel"],
        campaign_id=token.get("campaign_id"),
        source_id=token.get("source_id"),
        target_code=token.get("target_code") or lead.target_code,
        message=lead.message,
        external_id=lead.external_id,
        consent_granted=True if lead.consent else None,
        consent_source=f"formulaire : {token['name']}"[:100] if lead.consent else None,
        profile=lead.profile,
    )
    result = await prospects_api.ingest_prospect(
        payload, session, response, db, background, settings, session_factory, llm, calendar,
        knowledge,
    )  # fmt: skip
    return LeadAccepted(prospect_id=result.prospect.id, created=result.created)
