"""Hachage des mots de passe (argon2) et jetons d'accès JWT (S-04, S-06)."""

import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import Settings

_hasher = PasswordHasher()
# Hash factice : vérifié quand l'utilisateur n'existe pas, pour ne pas révéler par le temps
# de réponse si un compte existe.
DUMMY_HASH = _hasher.hash("dummy-password-for-timing-equalisation")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


def password_stamp(changed_at: datetime | None) -> int:
    """Marque du mot de passe courant (ms). Un jeton porte celle de son émission : après un
    changement de mot de passe, les jetons antérieurs ne correspondent plus."""
    if changed_at is None:
        return 0
    aware = changed_at if changed_at.tzinfo else changed_at.replace(tzinfo=UTC)
    return int(aware.timestamp() * 1000)


def create_access_token(user_id: int, settings: Settings, stamp: int = 0) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "pwd": stamp,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(
        claims, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm
    )


def decode_access_claims(token: str, settings: Settings) -> tuple[int, int] | None:
    """(identifiant utilisateur, marque du mot de passe), ou None si le jeton est invalide."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "exp"]},
        )
        return int(payload["sub"]), int(payload.get("pwd", 0))
    except (jwt.PyJWTError, ValueError, TypeError):
        return None


def decode_access_token(token: str, settings: Settings) -> int | None:
    """Retourne l'identifiant utilisateur, ou None si le jeton est invalide ou expiré."""
    claims = decode_access_claims(token, settings)
    return claims[0] if claims else None


def temporary_password() -> str:
    """Mot de passe temporaire lisible (16 caractères), affiché une seule fois."""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(16))
