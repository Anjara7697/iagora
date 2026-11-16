"""Sessions de la console, révocables côté serveur (AUDIT-SEC-009).

Chaque connexion ouvre une session en base ; le jeton d'accès porte son identifiant (`sid`). La
déconnexion la révoque : le jeton, même copié, est refusé avant son expiration. La désactivation du
compte et le changement de mot de passe restent couverts par `is_active` et `password_stamp`.
"""

import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.security import create_access_token, password_stamp
from app.models import AuthSession, User


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def open_session(session: AsyncSession, user: User, settings: Settings) -> str:
    """Ouvre une session et renvoie son jeton d'accès. Purge au passage les sessions expirées
    de l'utilisateur."""
    now = _now()
    await session.execute(
        delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < now)
    )
    record = AuthSession(
        id=secrets.token_hex(16),
        user_id=user.id,
        expires_at=now + timedelta(minutes=settings.access_token_expire_minutes),
    )
    session.add(record)
    await session.commit()
    return create_access_token(
        user.id, settings, password_stamp(user.password_changed_at), record.id
    )


async def is_active(session: AsyncSession, session_id: str, user_id: int) -> bool:
    if not session_id:
        return False
    record = await session.get(AuthSession, session_id)
    return (
        record is not None
        and record.user_id == user_id
        and record.revoked_at is None
        and _aware(record.expires_at) > _now()
    )


async def revoke(session: AsyncSession, session_id: str) -> None:
    """Sans effet si la session n'existe pas ou est déjà révoquée."""
    if not session_id:
        return
    await session.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await session.commit()
