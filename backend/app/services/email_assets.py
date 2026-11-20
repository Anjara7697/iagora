"""Images des emails de l'école (D-41) : le bandeau chargé dans Paramètres, gardé en base (hors Git,
D-28) et intégré à chaque email (pièce jointe en ligne), sans hébergement public."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.services.errors import ValidationFailure

COLLECTION = "email_assets"
BANNER = "banner"
BANNER_CID = "bandeau@iagora"
MAX_BANNER_BYTES = 400_000
_SIGNATURES = {"image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}


@dataclass(frozen=True)
class EmailImage:
    content_type: str
    data: bytes
    filename: str


def check_image(data: bytes) -> str:
    """Type réel de l'image d'après ses premiers octets (PNG ou JPEG), jamais d'après son nom."""
    if not data:
        raise ValidationFailure("Image vide")
    if len(data) > MAX_BANNER_BYTES:
        raise ValidationFailure(f"Image trop lourde : {MAX_BANNER_BYTES // 1000} ko au plus")
    for content_type, signature in _SIGNATURES.items():
        if data.startswith(signature):
            return content_type
    raise ValidationFailure("Format refusé : PNG ou JPEG seulement")


async def save_banner(db: Any, data: bytes, filename: str, actor_id: int | None) -> EmailImage:
    content_type = check_image(data)
    name = (filename or "bandeau").rsplit("/", 1)[-1][:120]
    await db[COLLECTION].replace_one(
        {"_id": BANNER},
        {
            "_id": BANNER,
            "content_type": content_type,
            "data": data,
            "filename": name,
            "size": len(data),
            "updated_at": datetime.now(UTC),
            "updated_by": actor_id,
        },
        upsert=True,
    )
    return EmailImage(content_type, data, name)


async def load_banner(db: Any) -> EmailImage | None:
    doc = await db[COLLECTION].find_one({"_id": BANNER})
    if not doc:
        return None
    return EmailImage(doc["content_type"], bytes(doc["data"]), doc.get("filename", "bandeau"))


async def delete_banner(db: Any) -> bool:
    result = await db[COLLECTION].delete_one({"_id": BANNER})
    return bool(result.deleted_count)
