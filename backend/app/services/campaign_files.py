"""Documents de campagne (D-42) : la brochure et les autres fichiers que l'agent peut joindre à un
email quand ils répondent au besoin du prospect. Gardés en base (hors Git, D-28), vérifiés sur leur
contenu (PDF, PNG ou JPEG), jamais d'après leur nom."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.services.errors import ConflictError, NotFoundError, ValidationFailure

COLLECTION = "campaign_files"
MAX_BYTES = 4_000_000  # sous la taille maximale d'une requête (5 Mo, enveloppe comprise)
MAX_FILES = 5
_SIGNATURES = {
    "application/pdf": b"%PDF-",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff",
}
_PROJECTION = {"data": 0}


@dataclass(frozen=True)
class CampaignFile:
    id: str
    label: str
    filename: str
    content_type: str
    data: bytes


def check_file(data: bytes) -> str:
    """Type réel du fichier d'après ses premiers octets."""
    if not data:
        raise ValidationFailure("Fichier vide")
    if len(data) > MAX_BYTES:
        raise ValidationFailure(f"Fichier trop lourd : {MAX_BYTES // 1_000_000} Mo au plus")
    for content_type, signature in _SIGNATURES.items():
        if data.startswith(signature):
            return content_type
    raise ValidationFailure("Format refusé : PDF, PNG ou JPEG seulement")


def _clean(text: str) -> str:
    return " ".join((text or "").split())


def _public(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc["_id"],
        "label": doc["label"],
        "usage": doc.get("usage", ""),
        "filename": doc["filename"],
        "content_type": doc["content_type"],
        "size": doc["size"],
        "created_at": doc["created_at"],
    }


async def list_files(db: Any, campaign_id: int) -> list[dict[str, Any]]:
    """Documents de la campagne, sans leur contenu, du plus ancien au plus récent."""
    docs = (
        await db[COLLECTION]
        .find({"campaign_id": campaign_id}, _PROJECTION)
        .sort("created_at", 1)
        .to_list(MAX_FILES * 2)
    )
    return [_public(d) for d in docs]


async def save_file(
    db: Any,
    campaign_id: int,
    data: bytes,
    filename: str,
    label: str,
    usage: str,
    actor_id: int | None,
) -> dict[str, Any]:
    content_type = check_file(data)
    label = _clean(label)[:120]
    if not label:
        raise ValidationFailure("Donnez un nom au document (ex. Brochure du programme)")
    existing = await list_files(db, campaign_id)
    if len(existing) >= MAX_FILES:
        raise ConflictError(f"{MAX_FILES} documents au plus par campagne")
    if any(f["label"].casefold() == label.casefold() for f in existing):
        raise ConflictError("Un document porte déjà ce nom dans la campagne")
    doc = {
        "_id": uuid4().hex,
        "campaign_id": campaign_id,
        "label": label,
        "usage": _clean(usage)[:300],
        "filename": _clean((filename or "document").rsplit("/", 1)[-1])[:120] or "document",
        "content_type": content_type,
        "size": len(data),
        "data": data,
        "created_at": datetime.now(UTC),
        "created_by": actor_id,
    }
    await db[COLLECTION].insert_one(doc)
    return _public(doc)


async def load_file(db: Any, file_id: str, campaign_id: int | None = None) -> CampaignFile:
    query: dict[str, Any] = {"_id": file_id}
    if campaign_id is not None:
        query["campaign_id"] = campaign_id
    doc = await db[COLLECTION].find_one(query)
    if not doc:
        raise NotFoundError("Document introuvable")
    return CampaignFile(
        doc["_id"], doc["label"], doc["filename"], doc["content_type"], bytes(doc["data"])
    )


async def delete_file(db: Any, campaign_id: int, file_id: str) -> None:
    result = await db[COLLECTION].delete_one({"_id": file_id, "campaign_id": campaign_id})
    if not result.deleted_count:
        raise NotFoundError("Document introuvable")
