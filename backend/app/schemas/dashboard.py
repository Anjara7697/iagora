from datetime import datetime

from pydantic import BaseModel, Field


class HotProspect(BaseModel):
    id: int
    name: str
    email: str | None = None
    stage: str
    level: str | None = None
    total_score: int
    campaign_id: int | None = None
    campaign_name: str | None = None


class AgentActivity(BaseModel):
    hours: int
    prospects_analysed: int
    drafts_generated: int
    sent_after_validation: int
    sent_without_validation: int = Field(
        description="Messages partis sans validation (0 tant que l'envoi autonome est coupé)"
    )
    escalations: int
    errors: int


class ScheduledFollowUp(BaseModel):
    id: int
    prospect_id: int
    prospect_name: str
    scheduled_at: datetime
    reason: str | None = None


class DashboardSummary(BaseModel):
    agent_mode: str
    hot_prospects: list[HotProspect]
    activity: AgentActivity
    follow_ups: list[ScheduledFollowUp]
    follow_ups_total: int
    funnel_days: int
    funnel: dict[str, int] = Field(description="Prospects arrivés dans la période, par étape")
    leads: int
