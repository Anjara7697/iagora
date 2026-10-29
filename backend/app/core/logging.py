"""Configuration de la journalisation. Ne jamais journaliser de secret (S-04, S-07)."""

import logging


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
    # httpx écrit l'URL complète de chaque requête en INFO : une URL peut porter un identifiant ou
    # un jeton. Les connecteurs envoient leurs secrets en en-tête ; ceci est une sécurité de plus.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(max(logging.WARNING, logging.getLogger().level))
