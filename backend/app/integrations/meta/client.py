"""Client minimal de l'API Graph officielle pour récupérer un Lead Ads."""

from typing import Any

import httpx

TIMEOUT = 10.0
GRAPH = "https://graph.facebook.com"


class MetaLeadError(Exception):
    pass


async def fetch_lead(
    leadgen_id: str,
    api_version: str,
    page_access_token: str,
    http: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    client = http or httpx.AsyncClient(timeout=TIMEOUT)
    owned = http is None
    try:
        response = await client.get(
            f"{GRAPH}/{api_version}/{leadgen_id}",
            params={
                "fields": (
                    "id,created_time,form_id,ad_id,ad_name,campaign_id,campaign_name,field_data"
                ),
                "access_token": page_access_token,
            },
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
