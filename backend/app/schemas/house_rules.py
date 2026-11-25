from datetime import datetime

from pydantic import BaseModel, Field, field_validator

STYLE_MAX = 2000
BANNED_MAX = 30
PHRASE_MAX = 80


class HouseRulesWrite(BaseModel):
    """Consignes maison (D-53) : ton et règles de style en texte libre, une consigne par ligne ;
    expressions que l'agent ne doit jamais écrire, vérifiées par le code."""

    style: str = Field("", max_length=STYLE_MAX)
    banned: list[str] = Field(default_factory=list, max_length=BANNED_MAX)

    @field_validator("banned")
    @classmethod
    def _phrases(cls, value: list[str]) -> list[str]:
        for phrase in value:
            text = " ".join(phrase.split())
            if text and len(text) < 2:
                raise ValueError("Une expression interdite fait au moins 2 caractères")
            if len(text) > PHRASE_MAX:
                raise ValueError(f"Une expression interdite fait au plus {PHRASE_MAX} caractères")
        return value


class HouseRulesRead(BaseModel):
    style: str
    banned: list[str]
    version: int = Field(description="0 : aucune consigne enregistrée")
    updated_by: int | None
    updated_at: datetime | None
