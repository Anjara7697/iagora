"""Connexion OAuth d'un conseiller à son propre compte Zoom (application « General » Zoom).

Zoom renouvelle le jeton de renouvellement à chaque usage : le nouveau doit être conservé.
"""

from typing import Any
from urllib.parse import urlencode

import httpx

from app.graph.ports import CalendarError

AUTH_URL = "https://zoom.us/oauth/authorize"
TOKEN_URL = "https://zoom.us/oauth/token"  # noqa: S105 - URL publique
REVOKE_URL = "https://zoom.us/oauth/revoke"
ME_URL = "https://api.zoom.us/v2/users/me"
TIMEOUT = 15.0


class ZoomAuthError(CalendarError):
    """Autorisation refusée ou révoquée : le conseiller doit reconnecter Zoom."""


def authorization_url(client_id: str, redirect_uri: str, state: str) -> str:
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(query)}"


async def _token(
    http: httpx.AsyncClient, client_id: str, secret: str, data: dict[str, str]
) -> dict[str, Any]:
    try:
        response = await http.post(TOKEN_URL, data=data, auth=(client_id, secret))
    except httpx.HTTPError as exc:
        raise CalendarError(f"Zoom injoignable ({type(exc).__name__})") from exc
    body: dict[str, Any] = response.json() if response.content else {}
    if response.status_code != 200:
        if response.status_code in {400, 401}:
            raise ZoomAuthError(
                f"Zoom : autorisation refusée ({body.get('reason') or body.get('error')})"
            )
        raise CalendarError(f"Zoom : erreur {response.status_code}")
    return body


async def exchange_code(
    http: httpx.AsyncClient, client_id: str, secret: str, code: str, redirect_uri: str
) -> tuple[str, str, int]:
    """Code d'autorisation -> (jeton d'accès, jeton de renouvellement, durée en secondes)."""
    body = await _token(
        http,
        client_id,
        secret,
        {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri},
    )
    return str(body["access_token"]), str(body["refresh_token"]), int(body.get("expires_in", 3600))


async def refresh(
    http: httpx.AsyncClient, client_id: str, secret: str, refresh_token: str
) -> tuple[str, str, int]:
    """-> (jeton d'accès, NOUVEAU jeton de renouvellement, durée)."""
    body = await _token(
        http, client_id, secret, {"grant_type": "refresh_token", "refresh_token": refresh_token}
    )
    return (
        str(body["access_token"]),
        str(body.get("refresh_token") or refresh_token),
        int(body.get("expires_in", 3600)),
    )


async def account_email(http: httpx.AsyncClient, access_token: str) -> str | None:
    try:
        r = await http.get(ME_URL, headers={"Authorization": f"Bearer {access_token}"})
    except httpx.HTTPError:
        return None
    return str(r.json().get("email")) if r.status_code == 200 else None


async def revoke(http: httpx.AsyncClient, client_id: str, secret: str, token: str) -> None:
    try:
        await http.post(REVOKE_URL, params={"token": token}, auth=(client_id, secret))
    except httpx.HTTPError:
        return
