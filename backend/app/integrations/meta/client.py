"""Client minimal de l'API Graph officielle pour récupérer un Lead Ads."""

import re
from typing import Any

import httpx

TIMEOUT = 10.0
GRAPH = "https://graph.facebook.com"


# Identifiant ou version insérés dans l'URL : jamais autre chose qu'un segment simple.
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SAFE_VERSION = re.compile(r"^v\d+\.\d+$")


class MetaLeadError(Exception):
    pass


async def fetch_lead(
    leadgen_id: str,
    api_version: str,
    page_access_token: str,
    http: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    if not SAFE_ID.match(leadgen_id) or not SAFE_VERSION.match(api_version):
        raise MetaLeadError("Identifiant de lead ou version d'API Meta invalide")
    client = http or httpx.AsyncClient(timeout=TIMEOUT)
    owned = http is None
    try:
        # Le jeton passe par l'en-tête, jamais dans l'URL : httpx journalise les URL (S-04).
        response = await client.get(
            f"{GRAPH}/{api_version}/{leadgen_id}",
            params={
                "fields": (
                    "id,created_time,form_id,ad_id,ad_name,campaign_id,campaign_name,field_data"
                ),
            },
            headers={"Authorization": f"Bearer {page_access_token}"},
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not payload.get("id"):
            raise MetaLeadError("Meta n'a pas renvoyé de lead exploitable")
        return payload
    except (httpx.HTTPError, ValueError) as exc:
        raise MetaLeadError("Impossible de récupérer le lead auprès de Meta") from exc
    finally:
        if owned:
            await client.aclose()
