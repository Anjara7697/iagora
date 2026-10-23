from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr


class CalendarSettingsWrite(BaseModel):
    provider: Literal["none", "demo", "google"] = "none"
    google_client_id: str = Field("", max_length=300)
    google_client_secret: SecretStr | None = Field(
        None, description="Vide : garder le secret enregistré"
    )
    default_user_id: int | None = Field(
        None, description="Conseiller dont l'agenda sert quand le prospect n'en a pas"
    )


class CalendarConnectionRead(BaseModel):
    user_id: int
    username: str | None = None
    account_email: str | None = None
    connected_at: datetime | None = None
    last_error: str | None = None


class CalendarSettingsRead(BaseModel):
    provider: Literal["none", "demo", "google"]
    source: Literal["console", "env"]
    google_client_id: str
    client_secret_set: bool
    default_user_id: int | None
    redirect_uri: str = Field(description="À déclarer dans l'application OAuth Google")
    connections: list[CalendarConnectionRead] = Field(default_factory=list)


class MyCalendarRead(BaseModel):
    available: bool = Field(description="L'administrateur a branché Google Agenda")
    connected: bool
    account_email: str | None = None
    connected_at: datetime | None = None
    last_error: str | None = None


class ConnectIn(BaseModel):
    return_to: str = Field(max_length=500, description="Page de la console où revenir")


class ConnectOut(BaseModel):
    url: str
