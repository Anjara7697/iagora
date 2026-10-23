"""Calcul des créneaux libres à partir des plages occupées (fonction pure, sans réseau).

Un créneau n'est proposé que s'il est dans les horaires de travail, assez loin dans le futur et
sans chevauchement avec une plage occupée : jamais de disponibilité inventée (NF-10).
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.graph.ports import Slot

Busy = tuple[datetime, datetime]


def slot_id(start: datetime) -> str:
    return start.astimezone(UTC).strftime("%Y%m%dT%H%MZ")


def _overlaps(start: datetime, end: datetime, busy: list[Busy]) -> bool:
    return any(start < b_end and end > b_start for b_start, b_end in busy)


def compute_slots(
    busy: list[Busy],
    *,
    now: datetime,
    count: int,
    tz: str,
    work_days: set[int],
    start_hour: int,
    end_hour: int,
    slot_minutes: int,
    min_notice_hours: int,
    horizon_days: int,
    buffer_minutes: int = 0,
) -> list[Slot]:
    """Jusqu'à `count` créneaux, répartis sur des jours différents quand c'est possible."""
    zone = ZoneInfo(tz)
    earliest = now + timedelta(hours=min_notice_hours)
    length = timedelta(minutes=slot_minutes)
    buffer = timedelta(minutes=buffer_minutes)
    padded = [(b_start - buffer, b_end + buffer) for b_start, b_end in busy]
    per_day: list[list[Slot]] = []
    first_day = now.astimezone(zone).date()
    for offset in range(horizon_days + 1):
        day = first_day + timedelta(days=offset)
        if day.isoweekday() not in work_days:
            continue
        cursor = datetime(day.year, day.month, day.day, start_hour, tzinfo=zone)
        limit = datetime(day.year, day.month, day.day, tzinfo=zone) + timedelta(hours=end_hour)
        candidates: list[Slot] = []
        while cursor + length <= limit:
            start, end = cursor.astimezone(UTC), (cursor + length).astimezone(UTC)
            if start >= earliest and not _overlaps(start, end, padded):
                candidates.append(Slot(id=slot_id(start), start=start, end=end))
            cursor += length
        if candidates:
            per_day.append(candidates)
    # Un premier créneau par jour d'abord (variété), puis on complète avec les suivants.
    chosen = [day_slots[0] for day_slots in per_day][:count]
    for day_slots in per_day:
        for slot in day_slots[1:]:
            if len(chosen) >= count:
                break
            chosen.append(slot)
    return sorted(chosen, key=lambda s: s.start)[:count]
