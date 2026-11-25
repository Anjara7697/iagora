from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

SuggestionStatus = Literal["pending", "approved", "rejected"]


class KbSuggestionRead(BaseModel):
    id: str
    status: SuggestionStatus
    question: str
    answer: str
    target_code: str | None = Field(description="Programme ; vide : commun à tous")
    prospect_question: str | None = Field(None, description="Question telle que posée")
    conversation_id: str | None = None
    prospect_id: int | None = None
    proposed_by: str | None = None
    created_at: datetime
    decided_by: str | None = None
    decided_at: datetime | None = None
    reason: str | None = Field(None, description="Motif du refus")
    document_slug: str | None = Field(None, description="FAQ où la réponse a été ajoutée")


class KbSuggestionPage(BaseModel):
    items: list[KbSuggestionRead]
    total: int


class KbSuggestionPrefill(BaseModel):
    question: str
    answer: str = Field(description="Dernière réponse du conseiller après le transfert")
    target_code: str | None
    existing: KbSuggestionRead | None = Field(
        None, description="Dernière proposition faite pour cette conversation"
    )


class KbSuggestionCreate(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=64)
    question: str = Field(min_length=5, max_length=500)
    answer: str = Field(min_length=5, max_length=4000)
    target_code: str | None = Field(None, max_length=60)


class KbSuggestionApprove(BaseModel):
    """Champs omis : on garde ceux de la proposition. `target_code: null` : document commun."""

    question: str | None = Field(None, min_length=5, max_length=500)
    answer: str | None = Field(None, min_length=5, max_length=4000)
    target_code: str | None = Field(None, max_length=60)


class KbSuggestionReject(BaseModel):
    reason: str | None = Field(None, max_length=300)
