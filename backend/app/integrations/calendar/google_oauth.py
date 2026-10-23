"""Connexion OAuth d'un conseiller à son Google Agenda (API officielle, S-08).

Le conseiller autorise IAGORA une fois ; on conserve son jeton de renouvellement (chiffré) et on
obtient à la demande des jetons d'accès de courte durée. Aucun secret n'est journalisé.
"""

from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from app.graph.ports import CalendarError

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - URL publique
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SCOPES = " ".join(
    [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.freebusy",
    ]
)
TIMEOUT = 15.0


class CalendarAuthError(CalendarError):
    """Autorisation refusée ou révoquée : le conseiller doit reconnecter son agenda."""


def authorization_url(client_id: str, redirect_uri: str, state: str, login_hint: str | None) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",  # jeton de renouvellement
        "prompt": "consent",  # garantit un jeton de renouvellement à chaque connexion
        "include_granted_scopes": "true",
        "state": state,
    }
    if login_hint:
        params["login_hint"] = login_hint
    return f"{AUTH_URL}?{urlencode(params)}"


async def _post(http: httpx.AsyncClient, data: dict[str, str]) -> dict[str, Any]:
    try:
        response = await http.post(TOKEN_URL, data=data)
    except httpx.HTTPError as exc:
        raise CalendarError(f"Google injoignable ({type(exc).__name__})") from exc
    body: dict[str, Any] = response.json() if response.content else {}
    if response.status_code != 200:
        if body.get("error") in {"invalid_grant", "unauthorized_client", "invalid_client"}:
            raise CalendarAuthError(f"Google : autorisation refusée ({body.get('error')})")
        raise CalendarError(f"Google : erreur {response.status_code}")
    return body


async def exchange_code(
    http: httpx.AsyncClient, client_id: str, secret: str, code: str, redirect_uri: str
) -> tuple[str, str | None]:
    """Code d'autorisation -> (jeton de renouvellement, email du compte Google)."""
    body = await _post(
        http,
        {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "client_secret": secret,
            "redirect_uri": redirect_uri,
        },
    )
    refresh = body.get("refresh_token")
    if not refresh:
        raise CalendarAuthError("Google n'a pas fourni d'accès durable : recommencez la connexion")
    email = None
    if body.get("id_token"):
        # Reçu directement de Google par TLS : la signature n'a pas à être revérifiée (OpenID).
        claims = jwt.decode(body["id_token"], options={"verify_signature": False})
        email = claims.get("email")
    return str(refresh), email


async def refresh_access_token(
    http: httpx.AsyncClient, client_id: str, secret: str, refresh_token: str
) -> tuple[str, int]:
    body = await _post(
        http,
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": secret,
        },
    )
    return str(body["access_token"]), int(body.get("expires_in", 3600))


async def revoke(http: httpx.AsyncClient, token: str) -> None:
    """Révoque l'autorisation chez Google (au mieux : la déconnexion locale suffit)."""
    try:
        await http.post(REVOKE_URL, params={"token": token})
    except httpx.HTTPError:
        return
