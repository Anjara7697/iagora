from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.enums import UserRole

MIN_PASSWORD_LENGTH = 12


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    email: EmailStr
    # Absent : un mot de passe temporaire est généré et renvoyé une seule fois.
    password: str | None = Field(None, min_length=MIN_PASSWORD_LENGTH, max_length=128)
    role: UserRole = UserRole.ADVISOR

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class UserUpdate(BaseModel):
    username: str | None = Field(None, min_length=3, max_length=100)
    email: EmailStr | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=MIN_PASSWORD_LENGTH, max_length=128)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str | None) -> str | None:
        return v.strip().lower() if v else v


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    role: UserRole
    is_active: bool
    must_change_password: bool = False
    created_at: datetime


class UserCreated(UserRead):
    temporary_password: str | None = Field(
        None, description="Mot de passe temporaire, affiché une seule fois"
    )


class TemporaryPassword(BaseModel):
    temporary_password: str


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105


class AdvisorRead(BaseModel):
    """Annuaire minimal : aucune donnée de connexion ni adresse email."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
