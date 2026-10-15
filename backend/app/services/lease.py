"""Bail de « chef » pour les tâches de fond (relances, boîte email).

Plusieurs instances du backend peuvent tourner : une seule doit exécuter chaque boucle à la fois,
sinon deux instances liraient la même boîte email ou rédigeraient deux brouillons. Le bail est un
document MongoDB renouvelé à chaque passage ; il expire tout seul si l'instance s'arrête.
"""

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

COLLECTION = "leases"
HOLDER = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"


async def acquire(db: Any, name: str, ttl_seconds: int, holder: str = HOLDER) -> bool:
    """Prend ou renouvelle le bail `name`. Retourne True si cette instance est la chef."""
    now = datetime.now(UTC)
    try:
        doc = await db[COLLECTION].find_one_and_update(
            {
                "_id": name,
                "$or": [{"holder": holder}, {"expires_at": {"$lt": now}}],
            },
            {"$set": {"holder": holder, "expires_at": now + timedelta(seconds=ttl_seconds)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        return False  # le bail existe, détenu par une autre instance encore valide
    return bool(doc and doc.get("holder") == holder)
