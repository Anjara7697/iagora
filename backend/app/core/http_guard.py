"""En-têtes de sécurité, taille maximale des requêtes et identifiant de requête (AUDIT-SEC-003,
AUDIT-API-003, AUDIT-API-002).

Middleware ASGI pur (sans `BaseHTTPMiddleware`) : il ne lit pas le corps et ne retarde aucune
réponse.
Le proxy (Caddy) ajoute HSTS et borne aussi la taille ; cette couche protège l'API même sans lui.
"""

import re
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from contextvars import ContextVar
from typing import Any

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", b"frame-ancestors 'none'"),
    (b"referrer-policy", b"no-referrer"),
)

_TOO_LARGE = b'{"detail":"Requ\xc3\xaate trop volumineuse"}'

# Identifiant de la requête en cours : repris de l'en-tête X-Request-ID s'il est sûr (proxy,
# client), sinon créé. Il apparaît dans chaque ligne de journal et dans la réponse, pour relier
# une erreur vue par un conseiller à sa trace.
REQUEST_ID: ContextVar[str | None] = ContextVar("request_id", default=None)
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _request_id(scope: Scope) -> str:
    for name, value in scope.get("headers", []):
        if name == b"x-request-id":
            candidate = str(value.decode("latin-1"))
            if _SAFE_ID.match(candidate):
                return candidate
    return uuid.uuid4().hex[:16]


class HttpGuard:
    def __init__(self, app: ASGIApp, *, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _request_id(scope)
        token = REQUEST_ID.set(request_id)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {name.lower() for name, _ in message.get("headers", [])}
                extra = [(n, v) for n, v in SECURITY_HEADERS if n not in present]
                if b"x-request-id" not in present:
                    extra.append((b"x-request-id", request_id.encode()))
                message["headers"] = [*message.get("headers", []), *extra]
            await send(message)

        # Gardé en cas d'exception : le gestionnaire des erreurs 500, plus à l'extérieur, s'en sert.
        await self._handle(scope, receive, send, send_with_headers)
        REQUEST_ID.reset(token)

    async def _handle(
        self, scope: Scope, receive: Receive, send: Send, send_with_headers: Send
    ) -> None:

        length = _content_length(scope)
        if length is not None and length > self.max_body_bytes:
            await send_with_headers(
                {
                    "type": "http.response.start",
                    "status": 413,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(_TOO_LARGE)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": _TOO_LARGE})
            return

        await self.app(scope, receive, send_with_headers)


def _content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", []):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None
