from datetime import datetime

from pydantic import BaseModel, Field, SecretStr, field_validator


class MetaFormMapping(BaseModel):
    form_id: str = Field(min_length=1, max_length=100)
    form_name: str = Field(min_length=1, max_length=160)
    campaign_id: int = Field(gt=0)
    source_id: int = Field(gt=0)
    target_code: str | None = Field(None, max_length=50)
    enabled: bool = True

    @field_validator("form_id", "form_name")
    @classmethod
    def strip_required(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Ce champ ne peut pas être vide")
        return value.strip()


class MetaConfigWrite(BaseModel):
    app_id: str = Field("", max_length=120)
    api_version: str = Field("v24.0", pattern=r"^v\d+\.\d+$", max_length=20)
    app_secret: SecretStr | None = Field(None, description="Vide : garder le secret enregistré")
    page_access_token: SecretStr | None = Field(
        None, description="Vide : garder le jeton enregistré"
    )
    verify_token: SecretStr | None = Field(
        None, description="Vide : garder le jeton de vérification enregistré"
    )
    enabled: bool = False
    mappings: list[MetaFormMapping] = Field(default_factory=list, max_length=100)

    @field_validator("mappings")
    @classmethod
    def unique_forms(cls, values: list[MetaFormMapping]) -> list[MetaFormMapping]:
        ids = [item.form_id for item in values]
        if len(ids) != len(set(ids)):
            raise ValueError("Un formulaire Meta ne peut être associé qu'une fois")
        return values


class MetaConfigRead(BaseModel):
    configured: bool
    enabled: bool
    app_id: str
    api_version: str
    app_secret_set: bool
    page_access_token_set: bool
    verify_token_set: bool
    mappings: list[MetaFormMapping] = Field(default_factory=list)
    webhook_path: str = "/api/v1/webhooks/meta"
    last_event_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    received: int = 0
    processed: int = 0
    failed: int = 0


class MetaSimulation(BaseModel):
    form_id: str = Field(min_length=1, max_length=100)
    first_name: str = Field("Test", max_length=100)
    last_name: str = Field("Meta", max_length=100)
    email: str = Field(pattern=r"^[^@\s]+@demo\.example\.com$", max_length=255)
    phone: str | None = Field(None, max_length=50)
    message: str | None = Field(None, max_length=5000)


class MetaSimulationResult(BaseModel):
    prospect_id: int
    created: bool
    duplicate: bool
