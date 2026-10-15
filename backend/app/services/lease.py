"""Bail de « chef » pour les tâches de fond (relances, boîte email).

Plusieurs instances du backend peuvent tourner : une seule doit exécuter chaque boucle à la fois,
sinon deux instances liraient la même boîte email ou rédigeraient deux brouillons. Le bail est un
document MongoDB renouvelé à chaque passage ; il expire tout seul si l'instance s'arrête.
"""

import asyncio
import contextlib
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.services.errors import ConflictError

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


@asynccontextmanager
async def conversation_lock(db: Any, conversation_id: str) -> AsyncIterator[None]:
    """Bail renouvelé et propriétaire unique, commun aux processus API et aux workers."""
    name, holder = f"agent:{conversation_id}", uuid.uuid4().hex
    if not await acquire(db, name, 90, holder):
        raise ConflictError("Un traitement de cette conversation est déjà en cours")
    owner = asyncio.current_task()

    async def renew() -> None:
        try:
            while True:
                await asyncio.sleep(30)
                if not await acquire(db, name, 90, holder):
                    raise ConflictError("Bail de conversation perdu")
        except Exception:
            if owner:
                owner.cancel()  # ne pas poursuivre un traitement sans exclusivité
            raise

    heartbeat = asyncio.create_task(renew())
    try:
        yield
    finally:
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await heartbeat
        await db[COLLECTION].delete_one({"_id": name, "holder": holder})
