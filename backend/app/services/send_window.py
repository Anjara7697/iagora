"""Fenêtre d'envoi des messages que l'agent prend l'initiative d'écrire (relances, premiers
contacts) : jours ouvrés sauf réglage contraire, heures de début et de fin des Paramètres, dans le
fuseau des Paramètres (décision D-21)."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.config import Settings


def in_send_window(now: datetime, settings: Settings) -> bool:
    """De l'heure de début (incluse) à l'heure de fin (exclue)."""
    local = now.astimezone(ZoneInfo(settings.calendar_timezone))
    return (local.weekday() < 5 or not settings.follow_up_weekdays_only) and (
        settings.follow_up_window_start_hour <= local.hour < settings.follow_up_window_end_hour
    )


def next_send_time(at: datetime, settings: Settings) -> datetime:
    """Premier instant, à partir de `at`, où un message à l'initiative de l'agent peut partir.

    Une relance programmée en dehors de la fenêtre attend son ouverture : c'est cette heure-là
    qu'on montre au conseiller. Une fenêtre vide (début ≥ fin) ne s'ouvre jamais : on rend `at`.
    """
    start, end = settings.follow_up_window_start_hour, settings.follow_up_window_end_hour
    if start >= end:
        return at
    zone = ZoneInfo(settings.calendar_timezone)
    local = at.astimezone(zone)
    for _ in range(8):  # au plus une semaine à parcourir
        if local.weekday() < 5 or not settings.follow_up_weekdays_only:
            opening = local.replace(hour=start, minute=0, second=0, microsecond=0)
            if local < opening:
                return opening.astimezone(at.tzinfo)
            if local.hour < end:
                return at
        local = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return at
