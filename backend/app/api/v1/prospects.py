import csv
import io
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import (
    ADMIN_ONLY,
    ANY_ROLE,
    CAN_WRITE,
    CalendarDep,
    CurrentUser,
    DbSession,
    KnowledgeDep,
    Llm,
    MongoDb,
    SessionFactoryDep,
    SettingsDep,
)
from app.api.v1.conversations import trigger_agent
from app.models import CampaignProspect, Prospect
from app.models.enums import ConsentStatus, Direction, InterestLevel, UserRole
from app.schemas.common import Page
from app.schemas.erasure import ErasureReport, ErasureRequest
from app.schemas.interaction import InteractionCreate, InteractionRead
from app.schemas.prospect import (
    CampaignAttribution,
    CampaignMembershipRead,
    ConsentRequest,
    OptOutRequest,
    ProspectDetail,
    ProspectIngest,
    ProspectIngestResult,
    ProspectUpdate,
)
from app.services import commercial_context, drafts, erasure, intake
from app.services import inbound as inbound_service
from app.services import interactions as interaction_service
from app.services import prospects as service

router = APIRouter(prefix="/prospects", tags=["prospects"], dependencies=[ANY_ROLE])


def _memberships(
    items: list[CampaignProspect], labels: dict[int, tuple[int, str]]
) -> list[CampaignMembershipRead]:
    out = []
    for m in items:
        read = CampaignMembershipRead.model_validate(m)
        if m.campaign_source_id in labels:
            read.campaign_id, read.campaign_name = labels[m.campaign_source_id]
        out.append(read)
    return out


async def _detail(session: DbSession, prospect: Prospect) -> ProspectDetail:
    memberships = await service.get_memberships(session, prospect.id)
    labels = await service.campaign_labels(session, [m.campaign_source_id for m in memberships])
    names = await commercial_context.source_names(
        session, [m.campaign_source_id for m in memberships]
    )
    selected = (await commercial_context.memberships(session, [prospect.id])).get(prospect.id)
    reads = _memberships(memberships, labels)
    sources = await commercial_context.source_ids(session, list(labels))
    for read in reads:
        read.source_name = names.get(read.campaign_source_id)
        read.source_id = sources.get(read.campaign_source_id)
    return ProspectDetail.model_validate(prospect).model_copy(
        update={"campaigns": reads, "current_membership_id": selected.id if selected else None}
    )


@router.post(
    "",
    response_model=ProspectIngestResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def ingest_prospect(
    payload: ProspectIngest,
    session: DbSession,
    response: Response,
    db: MongoDb,
    background: BackgroundTasks,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
) -> ProspectIngestResult:
    """Reçoit un prospect : déduplication, rattachement à la campagne, interaction d'entrée.
    201 si créé, 200 si un prospect existant a été reconnu."""
    prospect, created, interaction = await service.ingest_prospect(session, payload)
    if interaction.content:
        await inbound_service.on_prospect_message(
            session,
            db,
            prospect_id=prospect.id,
            channel=payload.channel,
            text=interaction.content,
        )
    if interaction.content or (settings.agent_auto_reply and payload.channel):
        cid = await intake.route_entry(session, db, interaction)
        if cid and prospect.consent_status is not ConsentStatus.OPTED_OUT:
            await trigger_agent(
                background, settings, cid, session_factory, db, llm, calendar, knowledge
            )
    if not created:
        response.status_code = status.HTTP_200_OK
    return ProspectIngestResult(
        prospect=await _detail(session, prospect), created=created, interaction_id=interaction.id
    )


@router.get("", response_model=Page[ProspectDetail])
async def list_prospects(
    session: DbSession,
    pending_campaign: bool = False,
    q: str | None = None,
    campaign_id: int | None = None,
    stage: str | None = None,
    advisor_id: int | None = None,
    level: Annotated[InterestLevel | None, Query(description="Niveau d'intérêt")] = None,
    consent_status: Annotated[ConsentStatus | None, Query(description="Consentement")] = None,
    demo: Annotated[
        Literal["all", "exclude", "only"],
        Query(description="Prospects fictifs : tous, exclus, ou seuls"),
    ] = "all",
    target_code: Annotated[str | None, Query(description="Programme visé")] = None,
    source_id: Annotated[int | None, Query(description="Source de leads")] = None,
    channel: Annotated[str | None, Query(description="Canal d'arrivée")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ProspectDetail]:
    """Liste paginée ; chaque prospect porte ses rattachements (étape, scores)."""
    items, total = await service.list_prospects(
        session, q=q, campaign_id=campaign_id, stage=stage, advisor_id=advisor_id,
        limit=limit, offset=offset, demo=demo, pending_campaign=pending_campaign,
        target_code=target_code, source_id=source_id, channel=channel,
        level=level.value if level else None,
        consent_status=consent_status.value if consent_status else None,
    )  # fmt: skip
    memberships = await service.get_memberships_for(session, [p.id for p in items])
    labels = await service.campaign_labels(
        session, [m.campaign_source_id for ms in memberships.values() for m in ms]
    )
    selected = await commercial_context.memberships(session, [p.id for p in items])
    names = await commercial_context.source_names(session, list(labels))
    reads = {pid: _memberships(ms, labels) for pid, ms in memberships.items()}
    sources = await commercial_context.source_ids(session, list(labels))
    for group in reads.values():
        for read in group:
            read.source_name = names.get(read.campaign_source_id)
            read.source_id = sources.get(read.campaign_source_id)
    return Page[ProspectDetail](
        items=[
            ProspectDetail.model_validate(p).model_copy(
                update={
                    "campaigns": reads[p.id],
                    "current_membership_id": selected[p.id].id if p.id in selected else None,
                }
            )
            for p in items
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


def _csv_cell(value: object) -> str:
    """Valeur de cellule sûre pour Excel : neutralise les formules (=, +, -, @)."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/export", dependencies=[CAN_WRITE])
async def export_prospects(
    session: DbSession,
    pending_campaign: bool = False,
    q: str | None = None,
    campaign_id: int | None = None,
    stage: str | None = None,
    advisor_id: int | None = None,
    level: InterestLevel | None = None,
    consent_status: ConsentStatus | None = None,
    target_code: str | None = None,
    source_id: int | None = None,
    channel: str | None = None,
    demo: Literal["all", "exclude", "only"] = "exclude",
) -> StreamingResponse:
    """Export CSV (Excel : UTF-8 avec BOM, séparateur « ; ») des prospects filtrés, 5 000 au plus.
    Les prospects fictifs sont exclus par défaut. Réservé aux conseillers et administrateurs."""
    items = await service.export_prospects(
        session, q=q, campaign_id=campaign_id, stage=stage, advisor_id=advisor_id,
        level=level.value if level else None,
        consent_status=consent_status.value if consent_status else None,
        target_code=target_code, source_id=source_id, channel=channel, demo=demo,
        pending_campaign=pending_campaign,
    )  # fmt: skip
    memberships = await service.get_memberships_for(session, [p.id for p in items])
    labels = await service.campaign_labels(
        session, [m.campaign_source_id for ms in memberships.values() for m in ms]
    )
    buffer = io.StringIO()
    sources = await commercial_context.source_ids(session, list(labels))
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(
        ["id", "prénom", "nom", "email", "téléphone", "consentement", "créé le",
         "campagne", "étape", "niveau d'intérêt", "score"]
    )  # fmt: skip
    for p in items:
        rows: list[CampaignProspect | None] = [*memberships[p.id]] or [None]
        for m in rows:
            if m is not None and (
                (
                    campaign_id is not None
                    and labels.get(m.campaign_source_id, (0, ""))[0] != campaign_id
                )
                or (source_id is not None and sources.get(m.campaign_source_id) != source_id)
                or (stage is not None and m.conversion_stage.value != stage)
                or (advisor_id is not None and m.assigned_advisor_id != advisor_id)
                or (level is not None and m.interest_status != level)
            ):
                continue
            campaign = labels.get(m.campaign_source_id, (0, ""))[1] if m else ""
            writer.writerow(
                [_csv_cell(v) for v in (
                    p.id, p.first_name, p.last_name, p.email, p.phone, p.consent_status.value,
                    p.created_at.strftime("%Y-%m-%d %H:%M"), campaign,
                    m.conversion_stage.value if m else "",
                    m.interest_status.value if m and m.interest_status else "",
                    m.total_score if m else "",
                )]
            )  # fmt: skip
    body = "\ufeff" + buffer.getvalue()
    return StreamingResponse(
        iter([body]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="prospects.csv"'},
    )


@router.get("/{prospect_id}", response_model=ProspectDetail)
async def get_prospect(prospect_id: int, session: DbSession) -> ProspectDetail:
    return await _detail(session, await service.get_prospect(session, prospect_id))


@router.patch("/{prospect_id}", response_model=ProspectDetail, dependencies=[CAN_WRITE])
async def update_prospect(
    prospect_id: int, payload: ProspectUpdate, session: DbSession
) -> ProspectDetail:
    return await _detail(session, await service.update_prospect(session, prospect_id, payload))


@router.post("/{prospect_id}/opt-out", response_model=ProspectDetail, dependencies=[CAN_WRITE])
async def opt_out(
    prospect_id: int, payload: OptOutRequest, session: DbSession, db: MongoDb
) -> ProspectDetail:
    """Enregistre la désinscription : bloque les communications sortantes, annule les relances
    et les brouillons de l'agent en attente de validation."""
    prospect = await service.opt_out(session, prospect_id, payload.source, payload.channel)
    await drafts.cancel_pending_for_prospect(db, prospect_id)
    await drafts.block_queued_for_prospect(db, prospect_id)
    return await _detail(session, prospect)


@router.post("/{prospect_id}/consent", response_model=ProspectDetail, dependencies=[CAN_WRITE])
async def grant_consent(
    prospect_id: int, payload: ConsentRequest, session: DbSession, user: CurrentUser
) -> ProspectDetail:
    """Enregistre un consentement. Lever une désinscription est réservé à un administrateur."""
    current = await service.get_prospect(session, prospect_id)
    if current.consent_status is ConsentStatus.OPTED_OUT and user.role is not UserRole.ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Seul un administrateur peut lever une désinscription",
        )
    prospect = await service.grant_consent(session, prospect_id, payload.source, payload.channel)
    return await _detail(session, prospect)


@router.post("/{prospect_id}/erase", response_model=ErasureReport, dependencies=[ADMIN_ONLY])
async def erase_prospect(
    prospect_id: int,
    payload: ErasureRequest,
    session: DbSession,
    db: MongoDb,
    user: CurrentUser,
) -> ErasureReport:
    """Efface définitivement un prospect et ses données (RGPD, art. 17) ; irréversible.

    La confirmation doit reprendre l'adresse email du prospect (son numéro de fiche s'il n'en a
    pas). Le rapport liste les événements d'agenda et de visio à supprimer à la main."""
    prospect = await service.get_prospect(session, prospect_id)
    expected = (prospect.email or str(prospect.id)).strip().lower()
    if payload.confirm.strip().lower() != expected:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La confirmation ne correspond pas à l'adresse email du prospect",
        )
    return await erasure.erase_prospect(
        session, db, prospect_id, reason=payload.reason, actor_id=user.id
    )


@router.post(
    "/{prospect_id}/interactions",
    response_model=InteractionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def create_interaction(
    prospect_id: int,
    payload: InteractionCreate,
    session: DbSession,
    response: Response,
    db: MongoDb,
    background: BackgroundTasks,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
) -> InteractionRead:
    interaction, created = await interaction_service.create_interaction(
        session, prospect_id, payload
    )
    if interaction.direction is Direction.INBOUND and interaction.content:
        await inbound_service.on_prospect_message(
            session,
            db,
            prospect_id=prospect_id,
            channel=payload.channel,
            text=interaction.content,
            is_new=created,
        )
    if interaction.direction is Direction.INBOUND and (
        interaction.content or (settings.agent_auto_reply and interaction.channel_id)
    ):
        cid = await intake.route_entry(session, db, interaction)
        if cid:
            await trigger_agent(
                background, settings, cid, session_factory, db, llm, calendar, knowledge
            )
    if not created:
        response.status_code = status.HTTP_200_OK
    return InteractionRead.model_validate(interaction)


@router.get("/{prospect_id}/interactions", response_model=Page[InteractionRead])
async def list_interactions(
    prospect_id: int,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[InteractionRead]:
    rows, total = await interaction_service.list_interactions(session, prospect_id, limit, offset)
    return Page[InteractionRead](
        items=[InteractionRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/{prospect_id}/campaigns", response_model=ProspectDetail, dependencies=[CAN_WRITE])
async def attribute_campaign(
    prospect_id: int,
    payload: CampaignAttribution,
    session: DbSession,
    db: MongoDb,
    user: CurrentUser,
    background: BackgroundTasks,
    settings: SettingsDep,
    session_factory: SessionFactoryDep,
    llm: Llm,
    calendar: CalendarDep,
    knowledge: KnowledgeDep,
) -> ProspectDetail:
    await service.attach_campaign(
        session, prospect_id, payload.campaign_id, payload.source_id, user.id
    )
    # Le contenu déjà reçu reste dans sa conversation ; aucune fausse réception n'est créée.
    docs = (
        await db["conversations"].find({"prospect_id": prospect_id, "status": "open"}).to_list(None)
    )
    for doc in docs:
        await trigger_agent(
            background, settings, str(doc["_id"]), session_factory, db, llm, calendar, knowledge
        )
    return await _detail(session, await service.get_prospect(session, prospect_id))
