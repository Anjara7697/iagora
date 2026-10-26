from datetime import UTC, datetime
from urllib.parse import urlparse

from pydantic import BaseModel, field_validator

from app.models.enums import AppointmentStatus


class AppointmentData(BaseModel):
    calendar_event_id: str | None
    zoom_meeting_id: str | None
    meeting_url: str | None
    start_at: datetime
    end_at: datetime


class AppointmentProspect(BaseModel):
    id: int
    first_name: str | None
    last_name: str | None
    email: str | None


class AppointmentRead(BaseModel):
    id: int
    prospect: AppointmentProspect
    advisor_id: int | None
    advisor_name: str | None
    start_at: datetime
    end_at: datetime
    status: AppointmentStatus
    meeting_url: str | None

    @field_validator("start_at", "end_at")
    @classmethod
    def aware_date(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value

    @field_validator("meeting_url")
    @classmethod
    def web_link(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            parsed = urlparse(value)
            return value if parsed.scheme in {"http", "https"} and parsed.hostname else None
        except ValueError:
            return None
