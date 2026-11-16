"""Index unique sur l'empreinte des jetons de service (AUDIT-DATA-009)."""

import pytest
from app.services import service_tokens
from pymongo.errors import DuplicateKeyError


async def test_token_lookup_uses_a_unique_index_on_the_hash(mongo_db):
    await service_tokens.ensure_indexes(mongo_db)
    await service_tokens.ensure_indexes(mongo_db)  # rejouable au démarrage
    info = await mongo_db[service_tokens.COLLECTION].index_information()
    assert any(spec["key"] == [("hash", 1)] and spec.get("unique") for spec in info.values())
    _, token = await service_tokens.create(mongo_db, {"name": "Formulaire"}, actor_id=None)
    assert await service_tokens.authenticate(mongo_db, token) is not None
    with pytest.raises(DuplicateKeyError):
        await mongo_db[service_tokens.COLLECTION].insert_one(
            {"_id": "autre", "hash": service_tokens._digest(token)}
        )
