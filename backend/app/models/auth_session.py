from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import CreatedAtMixin


class AuthSession(CreatedAtMixin, Base):
    """Session de la console (AUDIT-SEC-009) : le jeton d'accès porte son identifiant.

    La déconnexion la révoque côté serveur : un jeton copié ne sert plus, même avant son
    expiration. Les sessions expirées sont supprimées à la connexion suivante de l'utilisateur.
    """

    __tablename__ = "auth_sessions"

    # Aléatoire (128 bits), jamais dérivé de l'utilisateur.
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
