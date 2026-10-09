from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.enums import UserRole

MIN_PASSWORD_LENGTH = 12


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)
    role: UserRole = UserRole.ADVISOR

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class UserUpdate(BaseModel):
    username: str | None = Field(None, min_length=3, max_length=100)
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=MIN_PASSWORD_LENGTH, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105
