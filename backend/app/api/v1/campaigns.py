from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status

from app.api.dependencies import (
    ADMIN_ONLY,
    ANY_ROLE,
    CAN_WRITE,
    CurrentScope,
    CurrentUser,
    DbSession,
    MongoDb,
)
from app.core.agent_mode import AgentMode
from app.models.enums import CampaignStatus
from app.schemas.campaign import (
    AgentModesByKind,
    CampaignAgentModesRead,
    CampaignCreate,
    CampaignFileRead,
    CampaignOverview,
    CampaignOwnershipUpdate,
    CampaignRead,
    CampaignStats,
    CampaignUpdate,
    FirstContactsRead,
    SourceInput,
    TargetRead,
)
from app.schemas.common import Page
from app.services import agent_settings, campaign_files, campaign_ownership, first_contacts
from app.services import campaigns as service
from app.services import scope as scope_service

router = APIRouter(prefix="/campaigns", tags=["campaigns"], dependencies=[ANY_ROLE])


@router.post(
    "", response_model=CampaignRead, status_code=status.HTTP_201_CREATED, dependencies=[ADMIN_ONLY]
)
async def create_campaign(payload: CampaignCreate, session: DbSession) -> CampaignRead:
    campaign = await service.create_campaign(session, payload)
    return await service.to_read(session, campaign)


@router.get("", response_model=Page[CampaignRead])
async def list_campaigns(
    session: DbSession,
    advisor_id: int | None = None,
    status_: Annotated[CampaignStatus | None, Query(alias="status")] = None,
    sort: Annotated[
        service.CampaignSort | None,
        Query(description="Tri : name ou status, préfixé de « - » pour l'ordre décroissant"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[CampaignRead]:
    rows, total = await service.list_campaigns(
        session, status_, limit, offset, advisor_id=advisor_id, sort=sort
    )
    return Page[CampaignRead](
        items=[await service.to_read(session, c) for c in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/overview", response_model=list[CampaignOverview])
async def campaigns_overview(session: DbSession) -> list[CampaignOverview]:
    """Chiffres clés de toutes les campagnes (prospects, chauds, rendez-vous, convertis)."""
    return await service.overview(session)


@router.get("/{campaign_id}/stats", response_model=CampaignStats)
async def campaign_stats(campaign_id: int, session: DbSession) -> CampaignStats:
    """Entonnoir par étape, niveaux d'intérêt et prospects par source."""
    return await service.stats(session, campaign_id)


@router.get("/{campaign_id}", response_model=CampaignRead)
async def get_campaign(campaign_id: int, session: DbSession) -> CampaignRead:
    return await service.to_read(session, await service.get_campaign(session, campaign_id))


@router.patch("/{campaign_id}", response_model=CampaignRead, dependencies=[ADMIN_ONLY])
async def update_campaign(
    campaign_id: int, payload: CampaignUpdate, session: DbSession
) -> CampaignRead:
    campaign = await service.update_campaign(session, campaign_id, payload)
    return await service.to_read(session, campaign)


@router.put("/{campaign_id}/responsible", response_model=CampaignRead, dependencies=[ADMIN_ONLY])
async def set_campaign_responsible(
    campaign_id: int, payload: CampaignOwnershipUpdate, session: DbSession, user: CurrentUser
) -> CampaignRead:
    campaign = await campaign_ownership.set_responsible(session, campaign_id, payload, user.id)
    return await service.to_read(session, campaign)


@router.post(
    "/{campaign_id}/sources",
    response_model=CampaignRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
)
async def add_campaign_source(
    campaign_id: int, payload: SourceInput, session: DbSession
) -> CampaignRead:
    campaign = await service.add_source(session, campaign_id, payload)
    return await service.to_read(session, campaign)


@router.delete(
    "/{campaign_id}/sources/{source_id}", response_model=CampaignRead, dependencies=[ADMIN_ONLY]
)
async def remove_campaign_source(
    campaign_id: int, source_id: int, session: DbSession
) -> CampaignRead:
    """Détache une source ; refusé (409) si des prospects en proviennent."""
    campaign = await service.remove_source(session, campaign_id, source_id)
    return await service.to_read(session, campaign)


@router.get("/{campaign_id}/files", response_model=list[CampaignFileRead])
async def list_campaign_files(
    campaign_id: int, session: DbSession, db: MongoDb
) -> list[CampaignFileRead]:
    """Documents que l'agent peut joindre aux emails de cette campagne (D-42)."""
    await service.get_campaign(session, campaign_id)
    return [CampaignFileRead(**f) for f in await campaign_files.list_files(db, campaign_id)]


@router.post(
    "/{campaign_id}/files",
    response_model=CampaignFileRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ADMIN_ONLY],
)
async def upload_campaign_file(
    campaign_id: int,
    session: DbSession,
    db: MongoDb,
    user: CurrentUser,
    file: Annotated[UploadFile, File(description="PDF, PNG ou JPEG, 4 Mo au plus")],
    label: Annotated[str, Form(max_length=120, description="Nom donné à l'agent")],
    usage: Annotated[str, Form(max_length=300, description="Quand le joindre")] = "",
) -> CampaignFileRead:
    await service.get_campaign(session, campaign_id)
    data = await file.read(campaign_files.MAX_BYTES + 1)
    saved = await campaign_files.save_file(
        db, campaign_id, data, file.filename or "", label, usage, user.id
    )
    return CampaignFileRead(**saved)


@router.get(
    "/{campaign_id}/files/{file_id}",
    responses={200: {"content": {"application/pdf": {}, "image/png": {}, "image/jpeg": {}}}},
)
async def download_campaign_file(campaign_id: int, file_id: str, db: MongoDb) -> Response:
    """Le document tel qu'il part en pièce jointe, pour le relire avant de valider un brouillon."""
    found = await campaign_files.load_file(db, file_id, campaign_id)
    return Response(
        found.data,
        media_type=found.content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(found.filename)}",
            "Cache-Control": "no-store",
        },
    )


@router.delete(
    "/{campaign_id}/files/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[ADMIN_ONLY],
)
async def delete_campaign_file(campaign_id: int, file_id: str, db: MongoDb) -> None:
    """Retire le document : un brouillon qui le joignait ne partira plus (D-42)."""
    await campaign_files.delete_file(db, campaign_id, file_id)


targets_router = APIRouter(prefix="/targets", tags=["campaigns"], dependencies=[ANY_ROLE])


@targets_router.get("", response_model=list[TargetRead])
async def list_targets(session: DbSession) -> list[TargetRead]:
    """Cibles commerciales disponibles pour une campagne."""
    return [TargetRead.model_validate(t) for t in await service.list_targets(session)]


def _first_contacts_read(result: first_contacts.FirstContactPlan) -> FirstContactsRead:
    return FirstContactsRead(
        campaign_active=result.campaign_active,
        eligible=len(result.eligible),
        queued=result.queued,
        without_consent=result.without_consent,
        without_email=result.without_email,
        already_contacted=result.already_contacted,
        in_progress=result.in_progress,
        opted_out=result.opted_out,
    )


@router.get("/{campaign_id}/first-contacts", response_model=FirstContactsRead)
async def preview_first_contacts(
    campaign_id: int, session: DbSession, db: MongoDb, scope: CurrentScope
) -> FirstContactsRead:
    """Combien de personnes de la campagne recevraient un premier message de l'agent (D-29)."""
    visible = await scope_service.prospect_ids(session, scope)
    return _first_contacts_read(await first_contacts.plan(session, db, campaign_id, visible))


@router.post(
    "/{campaign_id}/first-contacts", response_model=FirstContactsRead, dependencies=[CAN_WRITE]
)
async def prepare_first_contacts(
    campaign_id: int, session: DbSession, db: MongoDb, scope: CurrentScope
) -> FirstContactsRead:
    """Demande à l'agent le premier message de chaque personne éligible. En mode assisté, chaque
    message devient un brouillon à valider (« À traiter », Premiers contacts) : rien ne part
    seul."""
    visible = await scope_service.prospect_ids(session, scope)
    return _first_contacts_read(await first_contacts.enqueue(session, db, campaign_id, visible))


async def _agent_modes_read(db: MongoDb, campaign_id: int) -> CampaignAgentModesRead:
    modes = await agent_settings.get_campaign_modes(db, campaign_id)
    return CampaignAgentModesRead(
        campaign_id=campaign_id,
        overrides=AgentModesByKind(**{k.value: v for k, v in modes.overrides.items()}),
        effective={
            k.value: v for k, v in (await agent_settings.effective_modes(db, campaign_id)).items()
        },
        global_mode=await agent_settings.get_mode(db),
        auto_allowed=agent_settings.auto_mode_allowed(),
        updated_by=modes.updated_by,
        updated_at=modes.updated_at,
    )


@router.get("/{campaign_id}/agent-modes", response_model=CampaignAgentModesRead)
async def get_agent_modes(
    campaign_id: int, session: DbSession, db: MongoDb
) -> CampaignAgentModesRead:
    """Autonomie de l'agent sur la campagne, par type de message (D-51)."""
    await service.get_campaign(session, campaign_id)
    return await _agent_modes_read(db, campaign_id)


@router.put(
    "/{campaign_id}/agent-modes",
    response_model=CampaignAgentModesRead,
    dependencies=[ADMIN_ONLY],
)
async def set_agent_modes(
    campaign_id: int,
    payload: AgentModesByKind,
    session: DbSession,
    db: MongoDb,
    user: CurrentUser,
) -> CampaignAgentModesRead:
    """Règle l'agent de la campagne pour les premiers contacts, les réponses et les relances :
    `null` (réglage général), `assisted`, `auto` ou `manual` (arrêté sur cette campagne).
    L'arrêt d'urgence général prime toujours ; `auto` reste refusé en production (D-16)."""
    await service.get_campaign(session, campaign_id)
    overrides = {
        agent_settings.MessageKind(kind): mode
        for kind, mode in payload.model_dump().items()
        if mode is not None
    }
    if AgentMode.AUTO in overrides.values() and not agent_settings.auto_mode_allowed():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                "Mode automatique désactivé en production : "
                "chaque réponse est validée par un conseiller"
            ),
        )
    await agent_settings.set_campaign_modes(db, campaign_id, overrides, user.id)
    return await _agent_modes_read(db, campaign_id)
