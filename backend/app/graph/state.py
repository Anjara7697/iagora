"""État partagé du workflow (SalesAgentState, CdC §9.3)."""

import operator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal, TypedDict

from pydantic import BaseModel, Field

from app.graph.ports import ProspectContext, Slot


class Action(StrEnum):
    """Prochaine action décidée par `decide_next_action`."""

    CONTINUE_CONVERSATION = "continue_conversation"
    NURTURE = "nurture"
    PROPOSE_MEETING = "propose_meeting"
    BOOK_MEETING = "book_meeting"
    HUMAN_HANDOFF = "human_handoff"
    OPT_OUT = "opt_out"
    CLOSE = "close"


Intent = Literal[
    "question",
    "interested",
    "meeting_request",
    "slot_choice",
    "meeting_declined",
    "not_interested",
    "opt_out",
    "needs_advisor",
    "other",
]


class Qualification(BaseModel):
    """Lecture structurée du dernier message du prospect (sortie du modèle de langage).

    Champs de profil explicites (pas de dictionnaire libre) : le modèle ne peut pas inventer de
    clés, et le schéma reste compatible avec tous les fournisseurs.
    """

    intent: Intent = Field(description="Intention principale du dernier message")
    sentiment: Literal["positive", "neutral", "negative"] = "neutral"
    needs_human: bool = Field(
        False, description="Vrai si la demande exige un conseiller (décision, cas sensible)"
    )
    confidence: float = Field(1.0, ge=0.0, le=1.0, description="Confiance dans cette lecture")
    asks_catalogue: bool = Field(
        False,
        description=(
            "Vrai si le prospect demande quelles formations ou quels programmes existent, sans "
            "demander de détail précis (durée, prix, admission, financement)"
        ),
    )
    chosen_slot: int | None = Field(
        None, description="Numéro (à partir de 1) du créneau choisi parmi ceux proposés"
    )
    study_level: str | None = Field(None, description="Niveau d'études, si le prospect l'indique")
    field_of_study: str | None = Field(None, description="Domaine d'études")
    current_situation: str | None = Field(None, description="Situation professionnelle actuelle")
    goal: str | None = Field(None, description="Objectif du prospect (ce qu'il recherche)")
    availability: str | None = Field(None, description="Disponibilités ou échéances indiquées")
    company_need: str | None = Field(None, description="Besoin de l'entreprise (profils cherchés)")

    def profile_updates(self) -> dict[str, str]:
        keys = (
            "study_level",
            "field_of_study",
            "current_situation",
            "goal",
            "availability",
            "company_need",
        )
        return {k: v.strip() for k in keys if (v := getattr(self, k)) and v.strip()}


@dataclass(frozen=True)
class Decision:
    action: Action
    reason: str  # justification en clair : toute décision automatisée est expliquée (OB-05)


@dataclass(frozen=True)
class TraceEntry:
    node: str
    summary: str
    at: datetime = field(default_factory=lambda: datetime.now(UTC))


class SalesAgentState(TypedDict, total=False):
    # Entrées
    prospect_id: int
    conversation_id: str
    trigger: Literal["inbound_message", "first_contact"]
    inbound_text: str
    # Contexte
    ctx: ProspectContext
    answer_channel: str
    target_code: str | None
    profile: dict[str, Any]
    missing_fields: list[str]
    # Qualification et score
    qualification: Qualification | None
    risk_alerts: list[str]
    llm_failed: bool
    interest_score: int
    fit_score: int
    total_score: int
    interest_level: str | None
    # Décision et actions
    decision: Decision
    reply_text: str | None
    reply_metadata: dict[str, Any]
    needs_human: bool
    handoff_reason: str | None
    slots: list[Slot]
    appointment_id: int | None
    followup_scheduled: bool
    stage_before: str | None
    stage_after: str | None
    opted_out: bool
    outcome: str
    # Journal de l'exécution (NF-04) : chaque noeud ajoute une entrée.
    trace: Annotated[list[TraceEntry], operator.add]
