"""Consultation des rendez-vous enregistrés, sans appel aux agendas externes."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.api.dependencies import ANY_ROLE, DbSession
from app.models.enums import AppointmentStatus
from app.schemas.appointment import AppointmentRead
from app.schemas.common import Page
from app.services import appointments

router = APIRouter(prefix="/appointments", tags=["appointments"], dependencies=[ANY_ROLE])


@router.get("", response_model=Page[AppointmentRead])
async def list_appointments(
    session: DbSession,
    when: Literal["upcoming", "past"] = "upcoming",
    status: AppointmentStatus | None = None,
    advisor_id: Annotated[int | None, Query(ge=1)] = None,
    demo: Literal["all", "exclude"] = "all",
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AppointmentRead]:
    """À venir inclut les rendez-vous en cours. Le statut enregistré reste inchangé.

    Tous les rôles authentifiés peuvent consulter, comme pour les prospects.
    advisor_id est un filtre de consultation, pas une restriction d'accès.
    """
    return await appointments.list_appointments(
        session,
        when=when,
        status=status,
        advisor_id=advisor_id,
        demo=demo,
        limit=limit,
        offset=offset,
    )
