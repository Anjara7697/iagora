"""Témoins (cookies) posés par l'API : session de la console et parcours OAuth.

- Session (AUDIT-SEC-004) : `HttpOnly` (illisible par le JavaScript de la page), `SameSite=Strict`,
  `Secure` en production ou derrière HTTPS, limité au chemin de l'API. La console et l'API doivent
  donc être servies sur le même site (même domaine enregistrable), ce que fait le bloc Caddy de
  `deploiement.md`.
- Parcours OAuth (AUDIT-SEC-008) : témoin court en `SameSite=Lax`, seul envoyé au retour de Google
  ou de Zoom (navigation venue d'un autre site). Il lie le lien d'autorisation au navigateur qui
  l'a demandé.
"""

from fastapi import Response

from app.config import Settings

SESSION_COOKIE = "iagora_session"
OAUTH_COOKIE = "iagora_oauth"  # suivi du parcours : `iagora_oauth_<usage>`
OAUTH_MAX_AGE = 10 * 60
# En-tête exigé sur les requêtes d'écriture authentifiées par le témoin : un formulaire d'un autre
# site ne peut pas le poser, et un appel `fetch` d'une autre origine est arrêté par CORS.
CSRF_HEADER = "X-IAGORA-CSRF"


def _secure(settings: Settings) -> bool:
    """`Secure` en production, et dès que la console n'est servie qu'en HTTPS (instance `dev`)."""
    origins = settings.cors_origins
    https_only = bool(origins) and all(o.startswith("https://") for o in origins)
    return settings.environment == "production" or https_only


def _path(settings: Settings) -> str:
    return settings.api_v1_prefix or "/"


def set_session(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.access_token_expire_minutes * 60,
        path=_path(settings),
        secure=_secure(settings),
        httponly=True,
        samesite="strict",
    )


def clear_session(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        path=_path(settings),
        secure=_secure(settings),
        httponly=True,
        samesite="strict",
    )


def oauth_name(purpose: str) -> str:
    """Un témoin par parcours : connecter Google puis Zoom en parallèle ne les mélange pas."""
    return f"{OAUTH_COOKIE}_{purpose}"


def set_oauth(response: Response, settings: Settings, purpose: str, nonce: str) -> None:
    response.set_cookie(
        oauth_name(purpose),
        nonce,
        max_age=OAUTH_MAX_AGE,
        path=_path(settings),
        secure=_secure(settings),
        httponly=True,
        samesite="lax",
    )


def clear_oauth(response: Response, settings: Settings, purpose: str) -> None:
    response.delete_cookie(
        oauth_name(purpose),
        path=_path(settings),
        secure=_secure(settings),
        httponly=True,
        samesite="lax",
    )
