"""Fenêtre d'envoi des messages que l'agent prend l'initiative d'écrire (relances, premiers
contacts) : jours ouvrés sauf réglage contraire, heures de début et de fin des Paramètres, dans le
fuseau des Paramètres (décision D-21)."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import Settings


def in_send_window(now: datetime, settings: Settings) -> bool:
    """De l'heure de début (incluse) à l'heure de fin (exclue)."""
    local = now.astimezone(ZoneInfo(settings.calendar_timezone))
    return (local.weekday() < 5 or not settings.follow_up_weekdays_only) and (
        settings.follow_up_window_start_hour <= local.hour < settings.follow_up_window_end_hour
    )
