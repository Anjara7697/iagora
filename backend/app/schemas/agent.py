from datetime import datetime
from typing import Any, Self

from pydantic import BaseModel, Field, model_validator


class AgentRunRequest(BaseModel):
    """Lance l'agent sur une conversation, ou ouvre/reprend celle d'un prospect."""

    conversation_id: str | None = None
    prospect_id: int | None = None
    channel: str | None = Field(
        None, description="Canal à utiliser si une conversation est ouverte"
    )

    @model_validator(mode="after")
    def _one_target(self) -> Self:
        if self.conversation_id is None and self.prospect_id is None:
            raise ValueError("Fournir conversation_id ou prospect_id")
        return self


class TraceRead(BaseModel):
    node: str
    summary: str
    at: datetime


class AgentRunResult(BaseModel):
    run_id: str
    prospect_id: int
    conversation_id: str
    trigger: str
    action: str = Field(description="Prochaine action décidée")
    reason: str = Field(description="Justification de la décision (OB-05)")
    outcome: str
    reply: str | None = Field(description="Message rédigé par l'agent, le cas échéant")
    handoff_reason: str | None
    stage_before: str | None
    stage_after: str | None
    scores: dict[str, Any]
    llm: dict[str, Any]
    trace: list[TraceRead]
    started_at: datetime
