"""Chiffrement des identifiants saisis dans la console (mots de passe de boîte, jetons) : S-04.

Les secrets sont chiffrés (Fernet : AES + HMAC) avant d'être enregistrés et ne sont jamais renvoyés
par l'API. La clé vient de `CONNECTORS_SECRET_KEY`, obligatoire en production (AUDIT-SEC-007) ; en
développement, à défaut, elle est dérivée de `JWT_SECRET_KEY`.

Passage à une clé dédiée : les secrets chiffrés avec l'ancienne clé (dérivée du secret JWT) restent
lisibles, puis `python -m app.cli rotate-connector-secrets` les rechiffre avec la nouvelle. Ensuite
seulement, le secret JWT peut changer sans rien perdre.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.config import Settings


class VaultError(Exception):
    """Secret illisible (clé changée, valeur corrompue)."""


def _derive(material: str) -> Fernet:
    key = hashlib.sha256(b"iagora-connectors:" + material.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _fernet(settings: Settings) -> MultiFernet:
    """Chiffre avec la clé courante ; déchiffre aussi avec l'ancienne clé dérivée du secret JWT."""
    own = settings.connectors_secret_key
    raw = own.get_secret_value() if own and own.get_secret_value() else None
    legacy = _derive(settings.jwt_secret_key.get_secret_value())
    return MultiFernet([_derive(raw), legacy] if raw else [legacy])


def encrypt(settings: Settings, plain: str) -> str:
    return _fernet(settings).encrypt(plain.encode()).decode()


def decrypt(settings: Settings, token: str) -> str:
    try:
        return _fernet(settings).decrypt(token.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise VaultError("Identifiant illisible : la clé a changé, ressaisissez-le") from exc


def rotate(settings: Settings, token: str) -> str:
    """Rechiffre un secret avec la clé courante (lisible avec l'une des clés connues)."""
    try:
        return _fernet(settings).rotate(token.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise VaultError("Identifiant illisible : la clé a changé, ressaisissez-le") from exc
