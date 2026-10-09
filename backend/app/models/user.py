from sqlalchemy import String, true
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import UserRole
from app.models.mixins import TimestampMixin, str_enum


class User(TimestampMixin, Base):
    """Utilisateur du tableau de bord ; un conseiller est un utilisateur de rôle ADVISOR."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    # Hash argon2 ; jamais le mot de passe en clair (S-04).
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(str_enum(UserRole, "user_role"))
    is_active: Mapped[bool] = mapped_column(server_default=true())
