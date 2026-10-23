from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, SecretStr

ZoomMode = Literal["none", "account", "advisor"]


class ZoomSettingsWrite(BaseModel):
    mode: ZoomMode = "none"
    account_id: str = Field("", max_length=200, description="Mode « account » seulement")
    client_id: str = Field("", max_length=200)
    client_secret: SecretStr | None = Field(None, description="Vide : garder le secret enregistré")
    host_user: str = Field("me", max_length=255, description="Hôte par défaut (mode « account »)")


class ZoomConnectionRead(BaseModel):
    user_id: int
    username: str | None = None
    account_email: str | None = None
    connected_at: datetime | None = None
    last_error: str | None = None


class ZoomSettingsRead(BaseModel):
    mode: ZoomMode
    source: Literal["console", "env"]
    account_id: str
    client_id: str
    client_secret_set: bool
    host_user: str
    redirect_uri: str = Field(description="À déclarer dans l'application Zoom (mode « advisor »)")
    connections: list[ZoomConnectionRead] = Field(default_factory=list)


class MyZoomRead(BaseModel):
    mode: ZoomMode
    connected: bool
    account_email: str | None = None
    connected_at: datetime | None = None
    last_error: str | None = None
