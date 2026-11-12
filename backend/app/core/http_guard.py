"""En-têtes de sécurité et taille maximale des requêtes (AUDIT-SEC-003, AUDIT-API-003).

Middleware ASGI pur (sans `BaseHTTPMiddleware`) : il ne lit pas le corps et ne retarde aucune
réponse.
Le proxy (Caddy) ajoute HSTS et borne aussi la taille ; cette couche protège l'API même sans lui.
"""

from collections.abc import Awaitable, Callable, MutableMapping
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


class HttpGuard:
    def __init__(self, app: ASGIApp, *, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {name.lower() for name, _ in message.get("headers", [])}
                extra = [(n, v) for n, v in SECURITY_HEADERS if n not in present]
                message["headers"] = [*message.get("headers", []), *extra]
            await send(message)

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
