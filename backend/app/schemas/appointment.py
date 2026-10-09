from datetime import datetime

from pydantic import BaseModel


class AppointmentData(BaseModel):
    calendar_event_id: str | None
    zoom_meeting_id: str | None
    meeting_url: str | None
    start_at: datetime
    end_at: datetime
