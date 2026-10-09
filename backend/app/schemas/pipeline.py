from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import ConversionStage, ScoreType, ScoringSignal
from app.schemas.prospect import CampaignMembershipRead


class MembershipUpdate(BaseModel):
    """Changement d'étape (justifié) et/ou affectation d'un conseiller."""

    conversion_stage: ConversionStage | None = None
    reason: str | None = Field(None, max_length=2000)
    assigned_advisor_id: int | None = Field(None, description="null : retire l'affectation")

    @model_validator(mode="after")
    def _stage_change_needs_reason(self) -> Self:
        if self.conversion_stage is not None and not (self.reason and self.reason.strip()):
            raise ValueError("Un changement d'étape doit être justifié (champ reason)")
        return self


class ScoreRequest(BaseModel):
    """Soit un signal d'engagement (règle prédéfinie), soit un ajustement manuel justifié."""

    signal: ScoringSignal | None = None
    score_type: ScoreType | None = None
    points: int | None = Field(None, ge=-100, le=100)
    reason: str | None = Field(None, max_length=2000)

    @model_validator(mode="after")
    def _signal_or_manual(self) -> Self:
        manual = [self.score_type, self.points, self.reason]
        if self.signal is not None:
            if any(v is not None for v in manual):
                raise ValueError("Fournir soit un signal, soit un ajustement manuel, pas les deux")
            return self
        if any(v is None for v in manual) or not (self.reason or "").strip():
            raise ValueError("Ajustement manuel : score_type, points et reason sont requis")
        if self.score_type is ScoreType.TOTAL:
            raise ValueError("Le score total est calculé ; ajuster interest ou fit")
        return self


class StageEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    from_stage: ConversionStage | None
    to_stage: ConversionStage
    reason: str | None
    actor_user_id: int | None
    created_at: datetime


class ScoreEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    score_type: ScoreType
    points: int
    new_value: int
    reason: str
    actor_user_id: int | None
    created_at: datetime


class ScoreResult(BaseModel):
    membership: CampaignMembershipRead
    events: list[ScoreEventRead]


class HistoryRead(BaseModel):
    stage_events: list[StageEventRead]
    score_events: list[ScoreEventRead]
