from pydantic import BaseModel, Field


class ApplicationResolution(BaseModel):
    membership_id: int = Field(gt=0, description="Parcours dont la candidature a été vérifiée")


class EnrollmentEmailResolution(BaseModel):
    membership_id: int = Field(gt=0, description="Parcours confirmé par la preuve")
    evidence_reference: str = Field(min_length=10, max_length=300)
    note: str | None = Field(None, max_length=1000)
