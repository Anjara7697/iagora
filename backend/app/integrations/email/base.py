"""Port du canal email : recevoir les messages des prospects, envoyer ceux que l'agent a validés."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


class EmailError(Exception):
    """Boîte email injoignable ou refus du serveur (identifiants, réseau, quota)."""


@dataclass(frozen=True)
class InboundEmail:
    uid: str  # identifiant du serveur (pour marquer le message comme lu)
    message_id: str  # En-tête Message-ID : sert d'identifiant d'idempotence
    from_address: str
    from_name: str
    subject: str
    text: str  # corps en texte, sans citation de la conversation précédente
    received_at: datetime
    in_reply_to: str | None = None
    references: list[str] = field(default_factory=list)
    is_automatic: bool = False  # réponse automatique, rebond, liste de diffusion
    suspect: bool = False  # authentification de l'expéditeur en échec (usurpation possible)


@dataclass(frozen=True)
class OutboundEmail:
    to_address: str
    subject: str
    text: str
    in_reply_to: str | None = None
    references: list[str] = field(default_factory=list)


class EmailClient(Protocol):
    async def fetch_unseen(self, limit: int = 50) -> list[InboundEmail]: ...

    async def mark_seen(self, uid: str) -> None: ...

    async def send(self, email: OutboundEmail) -> str:
        """Envoie le message et retourne son Message-ID."""
        ...

    async def check(self) -> dict[str, str]:
        """Teste la connexion (sans rien envoyer) : {"imap": "ok"|erreur, "smtp": "ok"|erreur}."""
        ...
