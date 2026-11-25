from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import DuplicateStatus
from app.schemas.prospect import ProspectRead


class DuplicateRead(BaseModel):
    """Paire de fiches qui semblent décrire la même personne."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    prospect_id: int
    other_prospect_id: int
    matched_fields: list[str] = Field(description="Identifiants partagés (email, phone, ...)")
    status: DuplicateStatus
    kept_prospect_id: int | None
    created_at: datetime
    resolved_at: datetime | None

    @field_validator("matched_fields", mode="before")
    @classmethod
    def _split(cls, value: object) -> object:
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value


class DuplicatePair(DuplicateRead):
    prospects: list[ProspectRead] = Field(description="Les deux fiches, la plus ancienne d'abord")


class MergeRequest(BaseModel):
    keep_prospect_id: int = Field(gt=0, description="Fiche gardée ; l'autre est supprimée")
