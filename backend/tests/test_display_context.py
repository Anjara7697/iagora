import csv
import io

from .test_campaigns_api import _create, _ingest


async def test_source_identity_and_filtered_export_do_not_mix_campaign_paths(client):
    first = (await _create(client, name="Campagne initiale")).json()
    second = (await _create(client, name="Campagne sélectionnée")).json()
    await _ingest(client, first, 0, "context@example.com")
    p = (await _ingest(client, second, 0, "context@example.com")).json()["prospect"]
    wanted = next(m for m in p["campaigns"] if m["campaign_id"] == second["id"])
    assert wanted["source_id"] == second["sources"][0]["id"]
    assert wanted["source_id"] != wanted["campaign_source_id"]
    params = {"campaign_id": second["id"], "source_id": wanted["source_id"]}
    listing = (await client.get("/api/v1/prospects", params=params)).json()
    assert listing["total"] == 1
    assert all(m["source_id"] == wanted["source_id"] for m in listing["items"][0]["campaigns"])
    export = await client.get("/api/v1/prospects/export", params=params)
    rows = list(csv.DictReader(io.StringIO(export.text.lstrip("\ufeff")), delimiter=";"))
    assert len(rows) == 1 and rows[0]["campagne"] == "Campagne sélectionnée"
