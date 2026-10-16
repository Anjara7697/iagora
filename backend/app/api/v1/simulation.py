"""API du parcours guidé, utilisable par l'écran et un futur orchestrateur n8n."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.dependencies import CAN_WRITE, CurrentUser, DbSession, Llm, MongoDb, SettingsDep
from app.devtools import simulation
from app.services import drafts


def enabled(settings: SettingsDep) -> None:
    if settings.environment == "production":
        raise HTTPException(403, "Simulation refusée en production")


router = APIRouter(
    prefix="/simulation", tags=["simulation"], dependencies=[CAN_WRITE, Depends(enabled)]
)


class SessionCreate(BaseModel):
    first_name: str = Field(default="Camille", min_length=1, max_length=80)


class Inbound(BaseModel):
    content: str = Field(min_length=1, max_length=20_000)
    external_message_id: str = Field(min_length=1, max_length=255)


@router.post("/sessions", status_code=201)
async def create(payload: SessionCreate, session: DbSession, db: MongoDb) -> dict[str, Any]:
    return await simulation.create(session, db, payload.first_name)


@router.post("/{cid}/messages")
async def receive(
    cid: str, payload: Inbound, session: DbSession, db: MongoDb, llm: Llm
) -> dict[str, Any]:
    await simulation.receive(session, db, cid, payload.content, payload.external_message_id, llm)
    return await simulation.report(session, db, cid)


@router.post("/{cid}/run")
async def run(cid: str, session: DbSession, db: MongoDb, llm: Llm) -> dict[str, Any]:
    await simulation.run(session, db, cid, llm, regenerate=True)
    return await simulation.report(session, db, cid)


@router.post("/{cid}/drafts/{mid}/approve")
async def approve(
    cid: str, mid: str, session: DbSession, db: MongoDb, user: CurrentUser
) -> dict[str, Any]:
    await simulation.require(session, db, cid)
    await drafts.approve(db, cid, mid, user.id, None)
    await simulation.dispatch(session, db, cid)
    return await simulation.report(session, db, cid)


@router.get("/{cid}/exchange")
async def exchange(cid: str, session: DbSession, db: MongoDb) -> dict[str, Any]:
    return await simulation.exchange(session, db, cid)


@router.get("/{cid}/report")
async def report(cid: str, session: DbSession, db: MongoDb) -> dict[str, Any]:
    return await simulation.report(session, db, cid)


@router.post("/{cid}/dispatch")
async def dispatch(cid: str, session: DbSession, db: MongoDb) -> dict[str, Any]:
    """Livre seulement les messages déjà autorisés, sans appel LLM ni validation implicite."""
    await simulation.dispatch(session, db, cid)
    return await simulation.exchange(session, db, cid)
