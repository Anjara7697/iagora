from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Direction


class InteractionCreate(BaseModel):
    type: str = Field(max_length=50, examples=["message", "email", "form_submission"])
    direction: Direction
    content: str | None = None
    channel: str | None = Field(None, description="Nom du canal (ex. email)")
    external_id: str | None = Field(None, max_length=255)
    intent: str | None = Field(None, max_length=100)
    sentiment: str | None = Field(None, max_length=50)


class InteractionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    prospect_id: int
    channel_id: int | None
    type: str
    direction: Direction
    content: str | None
    external_id: str | None
    intent: str | None
    sentiment: str | None
    created_at: datetime
