"""Comptes et authentification (S-06). Journalisation sans aucun secret (S-07)."""

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import DUMMY_HASH, hash_password, temporary_password, verify_password
from app.models import User
from app.models.enums import UserRole
from app.schemas.user import UserCreate, UserUpdate
from app.services.errors import ConflictError, NotFoundError, ValidationFailure

logger = logging.getLogger(__name__)


async def authenticate(session: AsyncSession, identifier: str, password: str) -> User | None:
    """Email ou nom d'utilisateur + mot de passe. None si les identifiants sont invalides
    ou le compte désactivé (même réponse dans tous les cas)."""
    ident = identifier.strip().lower()
    user = await session.scalar(
        select(User).where((func.lower(User.email) == ident) | (func.lower(User.username) == ident))
    )
    valid = verify_password(password, user.hashed_password if user else DUMMY_HASH)
    if user is None or not valid or not user.is_active:
        logger.warning("Échec de connexion pour l'identifiant fourni")
        return None
    return user


async def create_user(
    session: AsyncSession,
    data: UserCreate,
    *,
    actor: str = "system",
    must_change_password: bool = False,
) -> tuple[User, str | None]:
    """Crée le compte. Sans mot de passe fourni, en génère un temporaire (renvoyé une fois)."""
    generated = None if data.password else temporary_password()
    user = User(
        username=data.username.strip(),
        email=data.email,
        hashed_password=hash_password(data.password or generated or ""),
        role=data.role,
        must_change_password=must_change_password or generated is not None,
    )
    try:
        async with session.begin_nested():
            session.add(user)
            await session.flush()
    except IntegrityError:
        raise ConflictError("Email ou nom d'utilisateur déjà utilisé") from None
    await session.commit()
    logger.info("Utilisateur %s créé (rôle %s) par %s", user.id, user.role, actor)
    return user, generated


async def get_user(session: AsyncSession, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"Utilisateur {user_id} introuvable")
    return user


async def list_users(session: AsyncSession, limit: int, offset: int) -> tuple[list[User], int]:
    total = await session.scalar(select(func.count()).select_from(User)) or 0
    rows = await session.scalars(select(User).order_by(User.id).limit(limit).offset(offset))
    return list(rows), total


async def list_advisors(session: AsyncSession, limit: int, offset: int) -> tuple[list[User], int]:
    base = select(User).where(
        User.is_active.is_(True), User.role.in_((UserRole.ADMIN, UserRole.ADVISOR))
    )
    total = await session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = await session.scalars(base.order_by(User.username, User.id).limit(limit).offset(offset))
    return list(rows), total


async def update_user(
    session: AsyncSession, user_id: int, data: UserUpdate, *, actor: User
) -> User:
    user = await get_user(session, user_id)
    changes = data.model_dump(exclude_unset=True)
    if user.id == actor.id and (
        changes.get("is_active") is False or ("role" in changes and changes["role"] != user.role)
    ):
        raise ValidationFailure(
            "Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte"
        )
    if (password := changes.pop("password", None)) is not None:
        _set_password(user, password, temporary=user.id != actor.id)
    for field, value in changes.items():
        setattr(user, field, value)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ConflictError("Nom d'utilisateur ou email déjà utilisé") from None
    logger.info(
        "Utilisateur %s modifié par %s (champs : %s)",
        user.id,
        actor.id,
        sorted(data.model_fields_set),
    )
    return user


def _set_password(user: User, password: str, *, temporary: bool) -> None:
    """Nouveau mot de passe ; les sessions ouvertes avant ce moment sont révoquées."""
    user.hashed_password = hash_password(password)
    user.must_change_password = temporary
    user.password_changed_at = datetime.now(UTC)


async def reset_password(session: AsyncSession, user_id: int, *, actor: User) -> str:
    """Réinitialisation par un administrateur : mot de passe temporaire à changer."""
    user = await get_user(session, user_id)
    if user.id == actor.id:
        raise ValidationFailure("Changez votre propre mot de passe depuis « Mon compte »")
    password = temporary_password()
    _set_password(user, password, temporary=True)
    await session.commit()
    logger.info("Mot de passe de l'utilisateur %s réinitialisé par %s", user.id, actor.id)
    return password


async def change_own_password(session: AsyncSession, user: User, current: str, new: str) -> None:
    if not verify_password(current, user.hashed_password):
        raise ValidationFailure("Mot de passe actuel incorrect")
    if current == new:
        raise ValidationFailure("Le nouveau mot de passe doit être différent de l'actuel")
    _set_password(user, new, temporary=False)
    await session.commit()
    logger.info("Utilisateur %s : mot de passe changé", user.id)
