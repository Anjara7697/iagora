"""Remise à zéro des données d'une instance d'essai (D-30) : tout le métier part, le reste reste."""

import pytest
from app.config import Settings
from app.services import dev_reset, service_tokens
from app.services.errors import ConflictError

from .test_first_contacts import campaign, import_csv

API = "/api/v1"


async def test_reset_clears_business_data_and_keeps_accounts_and_settings(
    client, session_factory, mongo_db
):
    cid, sid = await campaign(client)
    await import_csv(client, cid, sid)
    doc = {"slug": "brochure", "title": "Brochure", "content": "## Durée\nDeux ans."}
    await client.post(f"{API}/knowledge/documents", json=doc)
    await mongo_db["settings"].insert_one(
        {"_id": "connector_meta", "mappings": [{"form_id": "f1", "campaign_id": cid}]}
    )
    _, token = await service_tokens.create(
        mongo_db, {"name": "site", "campaign_id": cid, "source_id": sid}, None
    )
    async with session_factory() as s:
        before = await dev_reset.preview(s, mongo_db)
    assert before.counts["prospects"] == 4 and before.counts["campagnes"] == 1

    async with session_factory() as s:
        report = await dev_reset.reset(s, mongo_db, Settings(_env_file=None))
    assert report.counts["prospects"] == 4
    assert any("formulaires Meta" in note for note in report.detached)
    async with session_factory() as s:
        after = await dev_reset.preview(s, mongo_db)
    assert set(after.counts.values()) == {0}

    # Comptes, jetons (sans destination) et réglages conservés : la console reste utilisable.
    assert (await client.get(f"{API}/auth/me")).status_code == 200
    kept = await service_tokens.authenticate(mongo_db, token)
    assert kept is not None and kept["campaign_id"] is None
    meta = await mongo_db["settings"].find_one({"_id": "connector_meta"})
    assert meta["mappings"] == []
    assert (await client.get(f"{API}/prospects")).json()["total"] == 0


def test_reset_is_refused_in_production():
    prod = Settings(
        _env_file=None,
        environment="production",
        jwt_secret_key="x" * 40,
        connectors_secret_key="k" * 40,
        cors_origins=["https://iagora.example.com"],
    )
    with pytest.raises(ConflictError, match="production"):
        dev_reset.guard(prod)
