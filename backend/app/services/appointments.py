"""Rendez-vous réservés (F-19)."""

from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment, Prospect, User
from app.models.enums import AppointmentStatus
from app.schemas.appointment import AppointmentData, AppointmentProspect, AppointmentRead
from app.schemas.common import Page
from app.services.demo import demo_filter


async def create_appointment(
    session: AsyncSession, prospect_id: int, advisor_id: int | None, data: AppointmentData
) -> Appointment:
    appointment = Appointment(
        prospect_id=prospect_id,
        advisor_id=advisor_id,
        calendar_event_id=data.calendar_event_id,
        zoom_meeting_id=data.zoom_meeting_id,
        meeting_url=data.meeting_url,
        start_at=data.start_at,
        end_at=data.end_at,
        status=AppointmentStatus.SCHEDULED,
    )
    session.add(appointment)
    await session.commit()
    return appointment


async def list_appointments(
    session: AsyncSession,
    *,
    when: Literal["upcoming", "past"],
    status: AppointmentStatus | None,
    advisor_id: int | None,
    demo: Literal["all", "exclude"],
    limit: int,
    offset: int,
) -> Page[AppointmentRead]:
    """Période fondée sur la fin du rendez-vous, sans déduire son statut de sa date."""
    now = datetime.now(UTC)
    filters = [Appointment.end_at >= now if when == "upcoming" else Appointment.end_at < now]
    if status is not None:
        filters.append(Appointment.status == status)
    if advisor_id is not None:
        filters.append(Appointment.advisor_id == advisor_id)
    if demo == "exclude":
        filters.append(~demo_filter())
    base = (
        select(Appointment).join(Prospect, Prospect.id == Appointment.prospect_id).where(*filters)
    )
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0
    order = (
        (Appointment.start_at.asc(), Appointment.id.asc())
        if when == "upcoming"
        else (Appointment.start_at.desc(), Appointment.id.desc())
    )
    rows = await session.execute(
        select(Appointment, Prospect, User.username)
        .join(Prospect, Prospect.id == Appointment.prospect_id)
        .outerjoin(User, User.id == Appointment.advisor_id)
        .where(*filters)
        .order_by(*order)
        .limit(limit)
        .offset(offset)
    )
    return Page[AppointmentRead](
        items=[
            AppointmentRead(
                id=a.id,
                prospect=AppointmentProspect(
                    id=p.id, first_name=p.first_name, last_name=p.last_name, email=p.email
                ),
                advisor_id=a.advisor_id,
                advisor_name=advisor_name,
                start_at=a.start_at,
                end_at=a.end_at,
                status=a.status,
                meeting_url=a.meeting_url,
            )
            for a, p, advisor_name in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
