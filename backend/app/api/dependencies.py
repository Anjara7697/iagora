from typing import Annotated

from fastapi import Depends, HTTPException, params, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.core.security import decode_access_token
from app.database.session import get_session
from app.models import User
from app.models.enums import UserRole

SettingsDep = Annotated[Settings, Depends(get_settings)]
DbSession = Annotated[AsyncSession, Depends(get_session)]

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentification requise",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)], session: DbSession, settings: SettingsDep
) -> User:
    """Utilisateur du jeton. Le rôle est relu en base à chaque requête : une désactivation
    ou un changement de rôle prend effet immédiatement."""
    user_id = decode_access_token(token, settings)
    if user_id is None:
        raise _UNAUTHORIZED
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise _UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> params.Depends:
    allowed = frozenset(roles)

    async def _check(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Droits insuffisants")
        return user

    dependency: params.Depends = Depends(_check)
    return dependency


# Matrice des droits (CdC §3.1, S-06) : lecture pour tous, écriture commerciale pour les
# conseillers, gestion (campagnes, comptes) pour les administrateurs.
ANY_ROLE = require_roles(UserRole.ADMIN, UserRole.ADVISOR, UserRole.VIEWER)
CAN_WRITE = require_roles(UserRole.ADMIN, UserRole.ADVISOR)
ADMIN_ONLY = require_roles(UserRole.ADMIN)
