"""Configuration de la journalisation. Ne jamais journaliser de secret (S-04, S-07)."""

import logging


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )
