"""Rendez-vous réservés (F-19)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment
from app.models.enums import AppointmentStatus
from app.schemas.appointment import AppointmentData


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
