from pydantic import BaseModel, Field


class ApplicationResolution(BaseModel):
    membership_id: int = Field(gt=0, description="Parcours dont la candidature a été vérifiée")
