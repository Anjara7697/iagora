"""Nouvel essai court pour Google Agenda et Zoom (AUDIT-AI-006).

Une limite de débit (429) n'a rien créé côté fournisseur : on peut toujours réessayer. Une erreur
serveur (5xx) ou une coupure réseau peut survenir après une création réussie : on ne réessaie
alors que les lectures (disponibilités), jamais une création, pour ne pas dupliquer un rendez-vous.
"""

import asyncio
from collections.abc import Awaitable, Callable

import httpx

ATTEMPTS = 3
BASE_DELAY = 0.5  # secondes, doublé à chaque essai
MAX_DELAY = 5.0
_ALWAYS = {429}
_READ_ONLY = {429, 500, 502, 503, 504}

sleep = asyncio.sleep  # remplaçable dans les tests


async def send(
    request: Callable[[], Awaitable[httpx.Response]], *, read_only: bool
) -> httpx.Response:
    """Exécute `request`, avec au plus `ATTEMPTS` essais. Renvoie la dernière réponse reçue ;
    une coupure réseau non réessayable est propagée telle quelle."""
    retry_on = _READ_ONLY if read_only else _ALWAYS
    for attempt in range(ATTEMPTS):
        last = attempt == ATTEMPTS - 1
        try:
            response = await request()
        except httpx.TransportError:
            if not read_only or last:
                raise
            await sleep(_delay(attempt, None))
            continue
        if response.status_code not in retry_on or last:
            return response
        await sleep(_delay(attempt, response.headers.get("Retry-After")))
    raise AssertionError("inaccessible")  # pragma: no cover


def _delay(attempt: int, retry_after: str | None) -> float:
    if retry_after and retry_after.isdigit():
        return min(float(retry_after), MAX_DELAY)
    return min(BASE_DELAY * 2.0**attempt, MAX_DELAY)
