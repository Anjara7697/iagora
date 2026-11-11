from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.dashboard import FunnelStep


class Delay(BaseModel):
    median_seconds: float | None = Field(description="Médiane ; None si aucune mesure")
    count: int = Field(description="Nombre de conversations mesurées")


class DraftOutcomes(BaseModel):
    generated: int
    approved_unchanged: int
    approved_edited: int
    rejected: int
    superseded: int
    pending: int


class RejectReason(BaseModel):
    reason: str
    count: int


class Coverage(BaseModel):
    questions: int = Field(description="Questions de prospects lues par l'agent")
    answered: int = Field(description="Dont traitées sans transfert « question hors base »")


class Analytics(BaseModel):
    """Analyses (Pilotage) sur la période, prospects fictifs exclus. Une valeur None signifie
    « pas de donnée » : elle n'est jamais remplacée par une estimation."""

    days: int
    since: datetime
    first_reply_sent: Delay = Field(description="1er message du prospect → 1re réponse envoyée")
    first_reply_drafted: Delay = Field(description="1er message du prospect → 1er message rédigé")
    average_confidence: float | None = Field(description="Confiance moyenne des brouillons (0-1)")
    drafts: DraftOutcomes
    reject_reasons: list[RejectReason]
    coverage: Coverage
    funnel: list[FunnelStep]
