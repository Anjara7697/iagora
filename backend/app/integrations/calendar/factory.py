from app.config import Settings
from app.graph.ports import Calendar
from app.integrations.calendar.agenda import DemoCalendar, GoogleZoomCalendar
from app.integrations.calendar.google_calendar import GoogleCalendarClient
from app.integrations.calendar.zoom import ZoomClient


def create_calendar(settings: Settings) -> Calendar | None:
    """L'agenda configuré, ou None (l'appelant garde alors « agenda non configuré » : transfert)."""
    if settings.calendar_provider == "google":
        return GoogleZoomCalendar(settings, GoogleCalendarClient(settings), ZoomClient(settings))
    if settings.calendar_provider == "demo":
        return DemoCalendar(settings)
    return None
