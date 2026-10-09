from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import AppointmentStatus
from app.models.mixins import TimestampMixin, str_enum


class Appointment(TimestampMixin, Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), index=True
    )
    advisor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    calendar_event_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    zoom_meeting_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    meeting_url: Mapped[str | None] = mapped_column(String(500))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[AppointmentStatus] = mapped_column(
        str_enum(AppointmentStatus, "appointment_status"),
        default=AppointmentStatus.PROPOSED,
        server_default=AppointmentStatus.PROPOSED.value,
    )
