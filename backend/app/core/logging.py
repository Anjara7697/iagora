"""Configuration de la journalisation. Ne jamais journaliser de secret (S-04, S-07)."""

import logging

from app.core.http_guard import REQUEST_ID


class RequestIdFilter(logging.Filter):
    """Ajoute l'identifiant de la requête en cours (« - » hors requête : tâches de fond)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = REQUEST_ID.get() or "-"
        return True


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s [%(request_id)s] - %(message)s",
    )
    for handler in logging.getLogger().handlers:
        if not any(isinstance(f, RequestIdFilter) for f in handler.filters):
            handler.addFilter(RequestIdFilter())
    # httpx écrit l'URL complète de chaque requête en INFO : une URL peut porter un identifiant ou
    # un jeton. Les connecteurs envoient leurs secrets en en-tête ; ceci est une sécurité de plus.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, logging.getLogger().level))
