"""Clé de chiffrement dédiée des connecteurs et rechiffrement des secrets (AUDIT-SEC-007)."""

import pytest
from app.config import Settings
from app.core import vault
from app.services import runtime_settings, secret_rotation


def _settings(**extra) -> Settings:
    return Settings(_env_file=None, jwt_secret_key="jwt-" + "j" * 40, **extra)


def test_production_requires_a_dedicated_connectors_key():
    prod = {
        "environment": "production",
        "jwt_secret_key": "x" * 40,
        "cors_origins": ["https://iagora.example.com"],
    }
    with pytest.raises(ValueError, match="CONNECTORS_SECRET_KEY"):
        Settings(_env_file=None, **prod)
    with pytest.raises(ValueError, match="CONNECTORS_SECRET_KEY"):
        Settings(_env_file=None, connectors_secret_key="court", **prod)
    with pytest.raises(ValueError, match="CONNECTORS_SECRET_KEY"):
        Settings(_env_file=None, connectors_secret_key="x" * 40, **prod)  # = secret JWT
    assert Settings(_env_file=None, connectors_secret_key="k" * 40, **prod)


def test_legacy_secrets_stay_readable_then_rotate_to_the_dedicated_key():
    legacy = _settings()
    old = vault.encrypt(legacy, "mot-de-passe-imap")
    dedicated = _settings(connectors_secret_key="c" * 40)
    assert vault.decrypt(dedicated, old) == "mot-de-passe-imap"  # ancienne clé encore connue
    rotated = vault.rotate(dedicated, old)
    # Après rotation, changer le secret JWT ne perd plus rien.
    new_jwt = Settings(
        _env_file=None, jwt_secret_key="autre-" + "z" * 40, connectors_secret_key="c" * 40
    )
    assert vault.decrypt(new_jwt, rotated) == "mot-de-passe-imap"
    with pytest.raises(vault.VaultError):
        vault.decrypt(new_jwt, old)


async def test_rotate_all_rewrites_every_stored_secret(mongo_db):
    legacy = _settings()
    await mongo_db["settings"].insert_one(
        {
            "_id": "connector_email",
            "host": "imap.example",
            "password_enc": vault.encrypt(legacy, "p"),
        }
    )
    await mongo_db[runtime_settings.COLLECTION].update_one(
        {"_id": runtime_settings.KEY},
        {"$set": {"secrets": {"gemini_api_key": vault.encrypt(legacy, "g")}}},
        upsert=True,
    )
    await mongo_db["calendar_connections"].insert_one(
        {"_id": 7, "refresh_token_enc": vault.encrypt(legacy, "r")}
    )
    await mongo_db["zoom_connections"].insert_one({"_id": 8, "refresh_token_enc": "corrompu"})
    dedicated = _settings(connectors_secret_key="c" * 40)
    report = await secret_rotation.rotate_all(mongo_db, dedicated)
    assert (report.rotated, report.unreadable) == (3, 1)
    only_new = Settings(_env_file=None, jwt_secret_key="j" * 50, connectors_secret_key="c" * 40)
    email = await mongo_db["settings"].find_one({"_id": "connector_email"})
    assert vault.decrypt(only_new, email["password_enc"]) == "p" and email["host"] == "imap.example"
    stored = await mongo_db[runtime_settings.COLLECTION].find_one({"_id": runtime_settings.KEY})
    assert vault.decrypt(only_new, stored["secrets"]["gemini_api_key"]) == "g"
    calendar = await mongo_db["calendar_connections"].find_one({"_id": 7})
    assert vault.decrypt(only_new, calendar["refresh_token_enc"]) == "r"
    zoom = await mongo_db["zoom_connections"].find_one({"_id": 8})
    assert zoom["refresh_token_enc"] == "corrompu"  # illisible : laissé tel quel, compté
