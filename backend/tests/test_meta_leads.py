import hashlib
import hmac
import json
import logging
from unittest.mock import AsyncMock

import httpx
from app.core.logging import configure_logging
from app.integrations.meta import MetaLeadError, fetch_lead
from app.models.enums import UserRole
from app.services import meta_leads

API = "/api/v1"
APP_SECRET = "meta-app-secret-for-tests"
PAGE_TOKEN = "meta-page-token-for-tests"
VERIFY_TOKEN = "meta-verify-token-for-tests"


async def _campaign(client):
    response = await client.post(
        f"{API}/campaigns",
        json={
            "name": "Meta rentrée 2027",
            "status": "active",
            "target_codes": ["ebihar_students"],
            "sources": [
                {
                    "name": "Facebook Lead Ads",
                    "type": "lead_ads",
                    "platform": "meta",
                    "external_id": "meta-page-1",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    campaign = response.json()
    return campaign["id"], campaign["sources"][0]["id"]


async def _configure(client, *, enabled=True, secrets=True):
    campaign_id, source_id = await _campaign(client)
    payload = {
        "app_id": "app-123",
        "api_version": "v24.0",
        "enabled": enabled,
        "mappings": [
            {
                "form_id": "form-123",
                "form_name": "Formulaire eBIHAR",
                "campaign_id": campaign_id,
                "source_id": source_id,
                "target_code": "ebihar_students",
                "enabled": True,
            }
        ],
    }
    if secrets:
        payload |= {
            "app_secret": APP_SECRET,
            "page_access_token": PAGE_TOKEN,
            "verify_token": VERIFY_TOKEN,
        }
    response = await client.put(f"{API}/integrations/meta", json=payload)
    return response, campaign_id


def _signed(payload):
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = "sha256=" + hmac.new(APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, {"X-Hub-Signature-256": signature, "Content-Type": "application/json"}


def _event(leadgen_id="lead-1", form_id="form-123"):
    return {
        "object": "page",
        "entry": [
            {
                "id": "page-1",
                "changes": [
                    {
                        "field": "leadgen",
                        "value": {"leadgen_id": leadgen_id, "form_id": form_id},
                    }
                ],
            }
        ],
    }


def _lead(leadgen_id="lead-1"):
    return {
        "id": leadgen_id,
        "form_id": "form-123",
        "ad_id": "ad-9",
        "ad_name": "Inscrivez-vous",
        "campaign_id": "meta-campaign-7",
        "campaign_name": "Rentrée Meta",
        "field_data": [
            {"name": "full_name", "values": ["Inès Dupont"]},
            {"name": "email", "values": ["ines@example.com"]},
            {"name": "phone_number", "values": ["06 01 02 03 04"]},
            {"name": "niveau", "values": ["Bac+3"]},
        ],
    }


async def test_meta_configuration_is_encrypted_and_secrets_are_never_returned(client, mongo_db):
    response, _ = await _configure(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["configured"] is True and body["enabled"] is True
    assert body["app_secret_set"] and body["page_access_token_set"]
    assert APP_SECRET not in response.text and PAGE_TOKEN not in response.text
    stored = await mongo_db["settings"].find_one({"_id": "connector_meta"})
    assert APP_SECRET not in str(stored) and PAGE_TOKEN not in str(stored)


async def test_meta_cannot_be_enabled_without_credentials_or_mapping(client):
    response, _ = await _configure(client, secrets=False)
    assert response.status_code == 422
    saved = (await client.get(f"{API}/integrations/meta")).json()
    assert saved["enabled"] is False and saved["configured"] is False


async def test_meta_mapping_must_point_to_a_linked_campaign_source(client):
    response = await client.put(
        f"{API}/integrations/meta",
        json={
            "app_id": "app",
            "mappings": [
                {
                    "form_id": "f",
                    "form_name": "Formulaire",
                    "campaign_id": 999,
                    "source_id": 999,
                }
            ],
        },
    )
    assert response.status_code == 422


async def test_webhook_verification_uses_the_saved_token(client, make_client):
    await _configure(client)
    anonymous = await make_client(None)
    ok = await anonymous.get(
        f"{API}/webhooks/meta",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": VERIFY_TOKEN,
            "hub.challenge": "challenge-42",
        },
    )
    assert ok.status_code == 200 and ok.text == "challenge-42"
    refused = await anonymous.get(
        f"{API}/webhooks/meta",
        params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "x"},
    )
    assert refused.status_code == 403


async def test_signed_lead_is_ingested_once_and_keeps_meta_trace(
    client, make_client, monkeypatch, mongo_db
):
    _, campaign_id = await _configure(client)
    fetch = AsyncMock(return_value=_lead())
    monkeypatch.setattr(meta_leads, "fetch_lead", fetch)
    anonymous = await make_client(None)
    body, headers = _signed(_event())
    accepted = await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    assert accepted.status_code == 200
    assert accepted.json() == {"accepted": 1, "duplicates": 0, "ignored": 0}
    fetch.assert_awaited_once_with("lead-1", "v24.0", PAGE_TOKEN)

    prospects = (await client.get(f"{API}/prospects")).json()
    assert prospects["total"] == 1
    prospect = prospects["items"][0]
    assert prospect["first_name"] == "Inès" and prospect["last_name"] == "Dupont"
    assert prospect["consent_status"] == "unknown"
    assert prospect["campaigns"][0]["campaign_id"] == campaign_id
    assert prospect["profile"]["meta"]["answers"] == {"niveau": ["Bac+3"]}
    stored = await mongo_db["meta_lead_events"].find_one({"_id": "lead-1"})
    assert stored["status"] == "processed" and stored["prospect_id"] == prospect["id"]

    replay = await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    assert replay.json() == {"accepted": 0, "duplicates": 1, "ignored": 0}
    assert fetch.await_count == 1


async def test_unsigned_or_inactive_webhook_is_refused(client, make_client):
    await _configure(client, enabled=False)
    anonymous = await make_client(None)
    body, headers = _signed(_event())
    assert (
        await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    ).status_code == 503
    await _configure(client)
    assert (await anonymous.post(f"{API}/webhooks/meta", content=body)).status_code == 401

    invalid_body, invalid_headers = _signed(["not-an-object"])
    invalid = await anonymous.post(
        f"{API}/webhooks/meta", content=invalid_body, headers=invalid_headers
    )
    assert invalid.status_code == 400


async def test_unknown_form_is_recorded_as_failed(client, make_client, mongo_db):
    await _configure(client)
    anonymous = await make_client(None)
    body, headers = _signed(_event(form_id="unknown"))
    response = await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    assert response.json()["accepted"] == 1
    event = await mongo_db["meta_lead_events"].find_one({"_id": "lead-1"})
    assert event["status"] == "failed" and "non associé" in event["last_error"]


async def test_graph_lead_from_another_form_is_not_misrouted(
    client, make_client, monkeypatch, mongo_db
):
    await _configure(client)
    monkeypatch.setattr(
        meta_leads,
        "fetch_lead",
        AsyncMock(return_value={**_lead("lead-wrong"), "form_id": "other"}),
    )
    anonymous = await make_client(None)
    body, headers = _signed(_event(leadgen_id="lead-wrong"))
    assert (
        await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    ).status_code == 200
    event = await mongo_db["meta_lead_events"].find_one({"_id": "lead-wrong"})
    assert event["status"] == "failed" and "ne correspond pas" in event["last_error"]
    assert (await client.get(f"{API}/prospects")).json()["total"] == 0


async def test_meta_simulator_creates_only_demo_prospects_and_is_idempotent(client):
    await _configure(client)
    payload = {
        "form_id": "form-123",
        "first_name": "Test",
        "last_name": "Meta",
        "email": "meta-lead@demo.example.com",
        "message": "Je souhaite en savoir plus",
    }
    first = await client.post(f"{API}/integrations/meta/simulate", json=payload)
    second = await client.post(f"{API}/integrations/meta/simulate", json=payload)
    assert first.status_code == 200 and first.json()["created"] is True
    assert second.json()["duplicate"] is True
    assert first.json()["prospect_id"] == second.json()["prospect_id"]


async def test_meta_configuration_is_admin_only(make_client):
    advisor = await make_client(UserRole.ADVISOR)
    assert (await advisor.get(f"{API}/integrations/meta")).status_code == 403


async def test_page_token_travels_in_a_header_and_never_in_logs(caplog):
    """httpx journalise l'URL de chaque requête en INFO : le jeton n'y figure pas (S-04)."""
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, json={"id": "lead-1", "form_id": "form-123"})

    configure_logging("INFO")
    caplog.set_level(logging.INFO)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await fetch_lead("lead-1", "v24.0", PAGE_TOKEN, http=http)
    request = seen["request"]
    assert request.headers["Authorization"] == f"Bearer {PAGE_TOKEN}"
    assert PAGE_TOKEN not in str(request.url)
    assert PAGE_TOKEN not in caplog.text


async def test_unsafe_identifiers_are_never_put_in_a_url():
    for leadgen_id, version in (("../me", "v24.0"), ("lead-1/x?y=1", "v24.0"), ("lead-1", "v24")):
        try:
            await fetch_lead(leadgen_id, version, PAGE_TOKEN)
        except MetaLeadError:
            continue
        raise AssertionError(f"{leadgen_id!r} {version!r} aurait dû être refusé")


async def test_webhook_ignores_a_lead_identifier_that_is_not_a_plain_id(
    client, make_client, monkeypatch
):
    await _configure(client)
    fetch = AsyncMock(return_value=_lead())
    monkeypatch.setattr(meta_leads, "fetch_lead", fetch)
    anonymous = await make_client(None)
    body, headers = _signed(_event(leadgen_id="../me"))
    response = await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"accepted": 0, "duplicates": 0, "ignored": 1}
    fetch.assert_not_awaited()


async def test_erasing_a_meta_prospect_unlinks_the_event_but_keeps_the_replay_marker(
    client, make_client, monkeypatch, mongo_db
):
    await _configure(client)
    monkeypatch.setattr(meta_leads, "fetch_lead", AsyncMock(return_value=_lead()))
    anonymous = await make_client(None)
    body, headers = _signed(_event())
    await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    prospect = (await client.get(f"{API}/prospects")).json()["items"][0]
    erased = await client.post(
        f"{API}/prospects/{prospect['id']}/erase",
        json={"reason": "request", "confirm": "ines@example.com"},
    )
    assert erased.status_code == 200, erased.text
    stored = await mongo_db["meta_lead_events"].find_one({"_id": "lead-1"})
    assert stored is not None and stored["status"] == "processed"
    assert "prospect_id" not in stored and "interaction_id" not in stored
    # Meta rejoue la notification : rien n'est recréé.
    replay = await anonymous.post(f"{API}/webhooks/meta", content=body, headers=headers)
    assert replay.json() == {"accepted": 0, "duplicates": 1, "ignored": 0}
    assert (await client.get(f"{API}/prospects")).json()["total"] == 0
