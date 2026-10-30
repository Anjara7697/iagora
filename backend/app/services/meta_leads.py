"""Réception idempotente et transformation des événements Meta Lead Ads."""

import logging
from datetime import UTC, datetime
from typing import Any

from pymongo.errors import DuplicateKeyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.integrations.meta import MetaLeadError, fetch_lead
from app.schemas.prospect import ProspectIngest
from app.services import meta_config, prospects

logger = logging.getLogger(__name__)
COLLECTION = "meta_lead_events"


def _now() -> datetime:
    return datetime.now(UTC)


async def enqueue(db: Any, leadgen_id: str, form_id: str, page_id: str | None) -> bool:
    """Réserve un lead avant de répondre au webhook. False signifie que Meta l'a rejoué."""
    try:
        await db[COLLECTION].insert_one(
            {
                "_id": leadgen_id,
                "form_id": form_id,
                "page_id": page_id,
                "status": "queued",
                "received_at": _now(),
                "attempts": 0,
                "last_error": None,
            }
        )
        return True
    except DuplicateKeyError:
        # Meta rejoue les notifications. Un événement déjà traité/planifié reste un doublon ;
        # un échec temporaire peut être repris trois fois sans créer une seconde réception.
        retry = await db[COLLECTION].update_one(
            {"_id": leadgen_id, "status": "failed", "attempts": {"$lt": 3}},
            {"$set": {"status": "queued", "last_error": None, "received_at": _now()}},
        )
        return bool(retry.modified_count)


async def mark_failed(db: Any, leadgen_id: str, error: str) -> None:
    await db[COLLECTION].update_one(
        {"_id": leadgen_id},
        {
            "$set": {"status": "failed", "last_error": error[:300], "finished_at": _now()},
            "$inc": {"attempts": 1},
        },
    )


def _field_values(payload: dict[str, Any]) -> dict[str, list[str]]:
    fields: dict[str, list[str]] = {}
    for field in payload.get("field_data") or []:
        if not isinstance(field, dict) or not field.get("name"):
            continue
        values = field.get("values") or []
        fields[str(field["name"]).strip().lower()] = [str(value).strip() for value in values]
    return fields


def _first(fields: dict[str, list[str]], *names: str) -> str | None:
    for name in names:
        values = fields.get(name) or []
        if values and values[0]:
            return values[0]
    return None


def to_ingest(leadgen_id: str, payload: dict[str, Any], mapping: dict[str, Any]) -> ProspectIngest:
    fields = _field_values(payload)
    first_name = _first(fields, "first_name", "firstname", "prénom", "prenom")
    last_name = _first(fields, "last_name", "lastname", "nom")
    full_name = _first(fields, "full_name", "fullname", "nom_complet")
    if full_name and not (first_name or last_name):
        parts = full_name.split(maxsplit=1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else None
    known = {
        "first_name",
        "firstname",
        "prénom",
        "prenom",
        "last_name",
        "lastname",
        "nom",
        "full_name",
        "fullname",
        "nom_complet",
        "email",
        "email_address",
        "e-mail",
        "phone_number",
        "phone",
        "téléphone",
        "telephone",
        "message",
        "project",
        "projet",
    }
    answers = {name: values for name, values in fields.items() if name not in known}
    profile: dict[str, Any] = {
        "meta": {
            "leadgen_id": leadgen_id,
            "form_id": str(payload.get("form_id") or mapping["form_id"]),
            "ad_id": payload.get("ad_id"),
            "ad_name": payload.get("ad_name"),
            "campaign_id": payload.get("campaign_id"),
            "campaign_name": payload.get("campaign_name"),
            "answers": answers,
        }
    }
    return ProspectIngest(
        first_name=first_name,
        last_name=last_name,
        email=_first(fields, "email", "email_address", "e-mail"),
        phone=_first(fields, "phone_number", "phone", "téléphone", "telephone"),
        channel="web_form",
        campaign_id=int(mapping["campaign_id"]),
        source_id=int(mapping["source_id"]),
        target_code=mapping.get("target_code"),
        message=_first(fields, "message", "project", "projet"),
        external_id=f"meta:{leadgen_id}",
        # Remplir un formulaire publicitaire ne prouve pas à lui seul un consentement marketing.
        consent_granted=None,
        profile=profile,
    )


async def process(
    db: Any,
    session_factory: Any,
    settings: Settings,
    leadgen_id: str,
) -> None:
    event = await db[COLLECTION].find_one({"_id": leadgen_id})
    if not event:
        return
    setup = await meta_config.setup(db, settings)
    mapping = meta_config.mapping_for(setup, str(event["form_id"]))
    if mapping is None:
        await mark_failed(db, leadgen_id, "Formulaire Meta non associé à une campagne")
        return
    if not setup.page_access_token:
        await mark_failed(db, leadgen_id, "Jeton de page Meta absent ou illisible")
        return
    try:
        payload = await fetch_lead(leadgen_id, setup.api_version, setup.page_access_token)
        if str(payload.get("form_id") or "") != str(event["form_id"]):
            raise ValueError("Le formulaire renvoyé par Meta ne correspond pas à l'événement")
        data = to_ingest(leadgen_id, payload, mapping)
        async with session_factory() as session:
            prospect, created, interaction = await prospects.ingest_prospect(session, data)
        await db[COLLECTION].update_one(
            {"_id": leadgen_id},
            {
                "$set": {
                    "status": "processed",
                    "prospect_id": prospect.id,
                    "interaction_id": interaction.id,
                    "created": created,
                    "last_error": None,
                    "finished_at": _now(),
                },
                "$inc": {"attempts": 1},
            },
        )
    except (MetaLeadError, ValueError, TypeError) as exc:
        logger.warning("Échec du traitement d'un lead Meta %s : %s", leadgen_id, exc)
        await mark_failed(db, leadgen_id, str(exc))
    except Exception:
        logger.exception("Échec inattendu du traitement d'un lead Meta %s", leadgen_id)
        await mark_failed(db, leadgen_id, "Erreur interne pendant le traitement")


async def stats(db: Any) -> dict[str, Any]:
    counts = {"received": 0, "processed": 0, "failed": 0}
    async for row in db[COLLECTION].aggregate(
        [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    ):
        counts["received"] += row["count"]
        if row["_id"] in counts:
            counts[row["_id"]] = row["count"]
    last = await db[COLLECTION].find_one({}, sort=[("received_at", -1)])
    success = await db[COLLECTION].find_one({"status": "processed"}, sort=[("finished_at", -1)])
    failed = await db[COLLECTION].find_one({"status": "failed"}, sort=[("finished_at", -1)])
    return {
        **counts,
        "last_event_at": last.get("received_at") if last else None,
        "last_success_at": success.get("finished_at") if success else None,
        "last_error": failed.get("last_error") if failed else None,
    }


async def simulate(
    session: AsyncSession, setup: meta_config.MetaSetup, data: Any
) -> tuple[int, bool, bool]:
    mapping = meta_config.mapping_for(setup, data.form_id)
    if mapping is None:
        raise ValueError("Formulaire Meta non associé ou désactivé")
    external_id = f"meta-sim:{data.form_id}:{data.email.lower()}"
    payload = ProspectIngest(
        first_name=data.first_name,
        last_name=data.last_name,
        email=data.email,
        phone=data.phone,
        channel="web_form",
        campaign_id=int(mapping["campaign_id"]),
        source_id=int(mapping["source_id"]),
        target_code=mapping.get("target_code"),
        message=data.message,
        external_id=external_id,
        profile={"meta": {"form_id": data.form_id, "simulated": True}},
    )
    prospect, created, _ = await prospects.ingest_prospect(session, payload)
    return prospect.id, created, not created
