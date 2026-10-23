"""Paramètres de l'agent (administrateur) : IA, relances, emails, disponibilités."""

import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status

from app.api.dependencies import ADMIN_ONLY, CurrentUser, MongoDb
from app.config import Settings, get_settings
from app.graph.ports import ChatMessage, LLMError
from app.integrations.llm.factory import create_language_model
from app.schemas.runtime_settings import (
    LlmTestResult,
    RuntimeSettingsRead,
    RuntimeSettingsWrite,
)
from app.services import runtime_settings

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[ADMIN_ONLY])
BaseSettings = Annotated[Settings, Depends(get_settings)]


def _plain(payload: RuntimeSettingsWrite) -> dict[str, Any]:
    data = payload.model_dump()
    for name in runtime_settings.SECRETS:
        secret = getattr(payload, name)
        data[name] = secret.get_secret_value() if secret else None
    return data


@router.get("", response_model=RuntimeSettingsRead)
async def get_runtime_settings(base: BaseSettings, db: MongoDb) -> RuntimeSettingsRead:
    doc = await runtime_settings.load(db)
    s = runtime_settings.apply(base, doc)
    values = {k: getattr(s, k) for k in runtime_settings.FIELDS}
    return RuntimeSettingsRead(
        **values,
        source="console" if doc else "env",
        gemini_api_key_set=bool(s.gemini_api_key and s.gemini_api_key.get_secret_value()),
        openai_api_key_set=bool(s.openai_api_key and s.openai_api_key.get_secret_value()),
        embedding_model=f"{s.embedding_provider}/{s.embedding_model}",
        updated_at=(doc or {}).get("updated_at"),
    )


@router.put("", status_code=status.HTTP_204_NO_CONTENT)
async def put_runtime_settings(
    payload: RuntimeSettingsWrite, base: BaseSettings, db: MongoDb, user: CurrentUser
) -> Response:
    """Pris en compte immédiatement par l'API et au prochain passage des tâches de fond."""
    await runtime_settings.save(db, base, _plain(payload), user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def reset_runtime_settings(db: MongoDb) -> Response:
    """Revient aux valeurs du `.env` (clés saisies dans la console comprises)."""
    await runtime_settings.reset(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/llm/test", response_model=LlmTestResult)
async def test_llm(payload: RuntimeSettingsWrite, base: BaseSettings, db: MongoDb) -> LlmTestResult:
    """Envoie une courte requête avec les réglages SAISIS (non enregistrés) : modèle principal
    puis, s'il est saturé, modèle de secours. Clé vide : celle déjà enregistrée."""
    existing = await runtime_settings.load(db)
    candidate = runtime_settings.apply(
        base, runtime_settings.to_document(base, _plain(payload), existing, None)
    )
    model = create_language_model(candidate)
    try:
        answer = await asyncio.wait_for(
            model.generate(
                "Réponds uniquement par le mot ok.",
                [ChatMessage(role="user", content="Test de connexion")],
            ),
            timeout=60,
        )
    except (LLMError, TimeoutError) as exc:
        return LlmTestResult(ok=False, model=candidate.llm_model, detail=str(exc)[:300])
    return LlmTestResult(ok=True, model=candidate.llm_model, detail=answer.strip()[:200])
