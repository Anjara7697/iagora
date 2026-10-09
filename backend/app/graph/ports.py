"""Interfaces (ports) dont dépend le workflow LangGraph.

Le coeur du graphe ne dépend d'aucune API ni d'aucun SDK de plateforme (NF-02) : il ne connaît
que ces interfaces. Les implémentations concrètes vivent dans `app/integrations/` (modèle de
langage, calendrier, canaux) et `app/agents/` (base de données).
Changer de fournisseur de modèle de langage = changer d'adaptateur, jamais le graphe (NF-01, NF-03).
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel

from app.models.enums import ConversionStage, ScoreType, ScoringSignal

T = TypeVar("T", bound=BaseModel)


# --- Erreurs ---


class LLMError(Exception):
    """Erreur du modèle de langage."""


class LLMUnavailableError(LLMError):
    """Modèle injoignable, quota dépassé ou erreur serveur, après les nouveaux essais (NF-05)."""


class LLMConfigError(LLMError):
    """Modèle non configuré (clé absente, fournisseur inconnu) : inutile de réessayer."""


class MessageBlockedError(Exception):
    """Envoi refusé (prospect désinscrit, conversation clôturée) : S-03."""


class CalendarError(Exception):
    """Agenda indisponible ou réservation impossible."""


# --- Modèle de langage ---


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class LanguageModel(Protocol):
    """Contrat minimal d'un modèle de langage, indépendant du fournisseur."""

    @property
    def provider(self) -> str: ...

    @property
    def model(self) -> str: ...

    async def generate(self, system: str, messages: Sequence[ChatMessage]) -> str:
        """Texte libre."""
        ...

    async def extract(self, system: str, messages: Sequence[ChatMessage], schema: type[T]) -> T:
        """Sortie structurée conforme à un schéma Pydantic."""
        ...


# --- Données échangées avec le monde extérieur ---


@dataclass(frozen=True)
class HistoryMessage:
    role: Literal["prospect", "agent", "advisor"]
    content: str
    created_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Slot:
    """Créneau réellement disponible dans l'agenda (jamais inventé : NF-10)."""

    id: str
    start: datetime
    end: datetime


@dataclass(frozen=True)
class BookedMeeting:
    calendar_event_id: str
    meeting_url: str | None
    zoom_meeting_id: str | None
    slot: Slot


@dataclass(frozen=True)
class Passage:
    """Extrait validé de la base de connaissances (RAG, F-14)."""

    source: str
    text: str
    score: float | None = None  # similarité avec la question (traçabilité, calibrage du seuil)


@dataclass
class ProspectContext:
    """Ce que le workflow sait d'un prospect au démarrage d'une exécution."""

    prospect_id: int
    conversation_id: str
    channel: str  # canal de la conversation : on répond là où le prospect a écrit (F-08)
    first_name: str | None
    last_name: str | None
    target_code: str | None
    campaign_name: str | None
    source_name: str | None
    membership_id: int | None
    stage: ConversionStage | None
    interest_score: int
    fit_score: int
    total_score: int
    interest_level: str | None
    advisor_id: int | None
    consent_status: str
    profile: dict[str, Any]
    history: list[HistoryMessage]
    pending_slots: list[Slot]
    email: str | None = None
    phone: str | None = None


@dataclass(frozen=True)
class ScoreChange:
    score_type: ScoreType
    points: int
    new_value: int
    reason: str


@dataclass(frozen=True)
class ScoreSnapshot:
    interest: int
    fit: int
    total: int
    level: str | None
    changes: list[ScoreChange]


@dataclass(frozen=True)
class HandoffSheet:
    """Fiche de transfert remise au conseiller (F-21)."""

    reason: str
    identity: dict[str, Any]
    campaign: str | None
    source: str | None
    channel: str
    summary: str
    history: list[dict[str, Any]]
    score: dict[str, Any]
    qualification: dict[str, Any]
    pending_question: str | None
    recommended_action: str


# --- Ports d'accès ---


class Gateway(Protocol):
    """Accès aux données métier (PostgreSQL / MongoDB)."""

    async def load_context(self, prospect_id: int, conversation_id: str) -> ProspectContext: ...

    async def save_profile(self, prospect_id: int, updates: dict[str, Any]) -> None: ...

    async def apply_signals(
        self, membership_id: int, signals: Sequence[ScoringSignal]
    ) -> ScoreSnapshot: ...

    async def change_stage(
        self, membership_id: int, stage: ConversionStage, reason: str
    ) -> None: ...

    async def record_opt_out(self, prospect_id: int, channel: str, source: str) -> None: ...

    async def schedule_follow_up(
        self,
        prospect_id: int,
        membership_id: int | None,
        channel: str,
        delay: timedelta,
        reason: str,
    ) -> None: ...

    async def save_handoff(self, conversation_id: str, sheet: HandoffSheet) -> None: ...

    async def close_conversation(self, conversation_id: str, summary: str | None) -> None: ...

    async def create_appointment(
        self, prospect_id: int, advisor_id: int | None, meeting: BookedMeeting
    ) -> int: ...


class Messenger(Protocol):
    """Envoi d'un message au prospect sur son canal."""

    async def send(self, ctx: ProspectContext, text: str, metadata: dict[str, Any]) -> None: ...


class Calendar(Protocol):
    async def get_available_slots(self, count: int) -> list[Slot]: ...

    async def book(self, slot: Slot, prospect_name: str | None) -> BookedMeeting: ...


class KnowledgeBase(Protocol):
    """Base de connaissances validée, par programme (RAG, §9.4)."""

    async def search(
        self, query: str, target_code: str | None, limit: int = 4
    ) -> list[Passage]: ...


@dataclass
class Deps:
    llm: LanguageModel
    gateway: Gateway
    messenger: Messenger
    calendar: Calendar
    knowledge: KnowledgeBase
