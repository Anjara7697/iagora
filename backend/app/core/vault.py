"""Chiffrement des identifiants saisis dans la console (mots de passe de boîte, jetons) : S-04.

Les secrets sont chiffrés (Fernet : AES + HMAC) avant d'être enregistrés et ne sont jamais renvoyés
par l'API. La clé vient de `CONNECTORS_SECRET_KEY`, à défaut elle est dérivée de `JWT_SECRET_KEY` :
changer cette clé oblige à ressaisir les identifiants des connecteurs.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings


class VaultError(Exception):
    """Secret illisible (clé changée, valeur corrompue)."""


def _fernet(settings: Settings) -> Fernet:
    own = settings.connectors_secret_key
    raw = own.get_secret_value() if own and own.get_secret_value() else None
    material = raw or settings.jwt_secret_key.get_secret_value()
    key = hashlib.sha256(b"iagora-connectors:" + material.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(settings: Settings, plain: str) -> str:
    return _fernet(settings).encrypt(plain.encode()).decode()


def decrypt(settings: Settings, token: str) -> str:
    try:
        return _fernet(settings).decrypt(token.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise VaultError("Identifiant illisible : la clé a changé, ressaisissez-le") from exc
