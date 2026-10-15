import csv
import io
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import ANY_ROLE, CAN_WRITE, CurrentUser, DbSession, MongoDb
from app.models import CampaignProspect, Prospect
from app.models.enums import ConsentStatus, Direction, InterestLevel, UserRole
from app.schemas.common import Page
from app.schemas.interaction import InteractionCreate, InteractionRead
from app.schemas.prospect import (
    CampaignMembershipRead,
    ConsentRequest,
    OptOutRequest,
    ProspectDetail,
    ProspectIngest,
    ProspectIngestResult,
    ProspectUpdate,
)
from app.services import drafts
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
    return ProspectDetail.model_validate(prospect).model_copy(
        update={"campaigns": _memberships(memberships, labels)}
    )


@router.post(
    "",
    response_model=ProspectIngestResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CAN_WRITE],
)
async def ingest_prospect(
    payload: ProspectIngest, session: DbSession, response: Response, db: MongoDb
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
    if not created:
        response.status_code = status.HTTP_200_OK
    return ProspectIngestResult(
        prospect=await _detail(session, prospect), created=created, interaction_id=interaction.id
    )


@router.get("", response_model=Page[ProspectDetail])
async def list_prospects(
    session: DbSession,
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
        limit=limit, offset=offset, demo=demo,
        target_code=target_code, source_id=source_id, channel=channel,
        level=level.value if level else None,
        consent_status=consent_status.value if consent_status else None,
    )  # fmt: skip
    memberships = await service.get_memberships_for(session, [p.id for p in items])
    labels = await service.campaign_labels(
        session, [m.campaign_source_id for ms in memberships.values() for m in ms]
    )
    return Page[ProspectDetail](
        items=[
            ProspectDetail.model_validate(p).model_copy(
                update={"campaigns": _memberships(memberships[p.id], labels)}
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
    )  # fmt: skip
    memberships = await service.get_memberships_for(session, [p.id for p in items])
    labels = await service.campaign_labels(
        session, [m.campaign_source_id for ms in memberships.values() for m in ms]
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(
        ["id", "prénom", "nom", "email", "téléphone", "consentement", "créé le",
         "campagne", "étape", "niveau d'intérêt", "score"]
    )  # fmt: skip
    for p in items:
        rows: list[CampaignProspect | None] = [*memberships[p.id]] or [None]
        for m in rows:
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
