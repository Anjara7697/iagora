from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import CampaignStatus


class SourceInput(BaseModel):
    name: str = Field(max_length=200)
    type: str = Field(max_length=50, examples=["ads", "form", "landing_page", "webinar", "import"])
    platform: str = Field(max_length=50, examples=["linkedin", "meta", "web"])
    external_id: str | None = Field(None, max_length=255)


class _CampaignDates(BaseModel):
    start_date: datetime | None = None
    end_date: datetime | None = None

    @model_validator(mode="after")
    def _check_dates(self) -> "_CampaignDates":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date doit être postérieure à start_date")
        return self


class CampaignCreate(_CampaignDates):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    status: CampaignStatus = CampaignStatus.DRAFT
    target_codes: list[str] = Field(default_factory=list)
    sources: list[SourceInput] = Field(default_factory=list)


class CampaignUpdate(_CampaignDates):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    status: CampaignStatus | None = None


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: str
    platform: str
    external_id: str | None


class TargetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str


class CampaignRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    status: CampaignStatus
    start_date: datetime | None
    end_date: datetime | None
    created_at: datetime
    updated_at: datetime
    targets: list[TargetRead] = []
    sources: list[SourceRead] = []
