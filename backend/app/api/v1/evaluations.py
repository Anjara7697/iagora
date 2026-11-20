"""API de la page Évaluation : lancer, suivre, importer et comparer les passages d'évaluation.

Outil de recette réservé aux administrateurs et refusé en production : un passage crée des
prospects fictifs et, avec le vrai modèle, consomme du quota (voir `app/devtools/eval_runs.py`).
"""

from datetime import datetime
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.dependencies import (
    ADMIN_ONLY,
    CurrentUser,
    EmbeddingsDep,
    Llm,
    MongoDb,
    SessionFactoryDep,
    SettingsDep,
)
from app.devtools import eval_runs


def enabled(settings: SettingsDep) -> None:
    if settings.environment == "production":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Évaluation refusée en production")


router = APIRouter(
    prefix="/evaluations", tags=["evaluations"], dependencies=[ADMIN_ONLY, Depends(enabled)]
)


class ImportPayload(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    notes: str = Field("", max_length=4000)
    ran_at: datetime | None = Field(None, description="Date du passage (défaut : maintenant)")
    file_name: str | None = Field(None, max_length=255)
    report: dict[str, Any] = Field(description="JSON écrit par --json (eval-agent, …)")


class RunUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=120)
    notes: str | None = Field(None, max_length=4000)
    ran_at: datetime | None = None


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Passage introuvable")


@router.get("/catalog")
async def catalog(settings: SettingsDep, llm: Llm, embeddings: EmbeddingsDep) -> dict[str, Any]:
    """Suites, cas et conversations disponibles, modèle et embeddings utilisables."""
    return eval_runs.catalog(settings, llm, embeddings)


@router.get("")
async def list_runs(db: MongoDb) -> list[dict[str, Any]]:
    """Passages du plus récent au plus ancien, sans le rapport détaillé (indicateurs inclus)."""
    return await eval_runs.list_runs(db)


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def start_run(
    payload: eval_runs.RunSettings,
    db: MongoDb,
    session_factory: SessionFactoryDep,
    settings: SettingsDep,
    llm: Llm,
    embeddings: EmbeddingsDep,
    user: CurrentUser,
) -> dict[str, Any]:
    """Lance un passage en tâche de fond ; suivre son avancement avec `GET /evaluations/{id}`."""
    try:
        # La fabrique de l'API est un `async_sessionmaker` (voir `get_session_factory`).
        factory = cast(async_sessionmaker[AsyncSession], session_factory)
        return await eval_runs.start(
            db, factory, payload, app_settings=settings, llm=llm,
            embeddings=embeddings, user_id=user.id,
        )  # fmt: skip
    except eval_runs.RunInProgress as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except eval_runs.EvaluationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_report(payload: ImportPayload, db: MongoDb, user: CurrentUser) -> dict[str, Any]:
    """Ajoute à l'historique un rapport JSON produit en ligne de commande (`--json`)."""
    try:
        return await eval_runs.import_report(
            db, payload.report, label=payload.label, ran_at=payload.ran_at,
            notes=payload.notes, file_name=payload.file_name, user_id=user.id,
        )  # fmt: skip
    except eval_runs.EvaluationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("/{run_id}")
async def get_run(run_id: str, db: MongoDb) -> dict[str, Any]:
    run = await eval_runs.get_run(db, run_id)
    if run is None:
        raise _not_found()
    return run


@router.patch("/{run_id}")
async def update_run(run_id: str, payload: RunUpdate, db: MongoDb) -> dict[str, Any]:
    run = await eval_runs.update_run(db, run_id, payload.model_dump(exclude_none=True))
    if run is None:
        raise _not_found()
    return run


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: str, db: MongoDb) -> dict[str, Any]:
    """Arrête le passage en cours ; les résultats déjà obtenus sont gardés."""
    if not await eval_runs.cancel(db, run_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce passage n'est pas en cours")
    run = await eval_runs.get_run(db, run_id)
    if run is None:
        raise _not_found()
    return run


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_run(run_id: str, db: MongoDb) -> Response:
    try:
        deleted = await eval_runs.delete_run(db, run_id)
    except eval_runs.RunInProgress as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    if not deleted:
        raise _not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
