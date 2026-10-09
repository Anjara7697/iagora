"""Choix du fournisseur d'embeddings par configuration (EMBEDDING_PROVIDER).

Comme pour le modèle de langage : changer de fournisseur ne touche ni le workflow ni la base de
connaissances, mais impose de recalculer les vecteurs (`python -m app.cli kb-reindex`).
"""

import asyncio
import math
from collections.abc import Callable, Sequence
from functools import partial
from typing import Any

from app.config import Settings
from app.integrations.embeddings.base import EmbeddingError, EmbeddingModel
from app.models.types import EMBEDDING_DIMENSIONS

BATCH_SIZE = 50


def _normalize(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]


class GeminiEmbeddings:
    def __init__(self, model: str, api_key: str, max_retries: int = 3) -> None:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        self._model = model
        self._max_retries = max_retries
        self._client = GoogleGenerativeAIEmbeddings(
            model=f"models/{model}",
            google_api_key=api_key,
            output_dimensionality=EMBEDDING_DIMENSIONS,
        )

    @property
    def model_id(self) -> str:
        return f"gemini/{self._model}"

    async def _call(self, fn: Callable[[], Any]) -> Any:
        last: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                return await asyncio.to_thread(fn)
            except Exception as exc:  # noqa: BLE001 - toute erreur fournisseur : nouvel essai
                last = exc
                await asyncio.sleep(min(2**attempt, 8))
        raise EmbeddingError(f"{type(last).__name__}: {last}") from last

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for i in range(0, len(texts), BATCH_SIZE):
            batch = list(texts[i : i + BATCH_SIZE])
            result = await self._call(partial(self._client.embed_documents, batch))
            vectors.extend(_normalize(v) for v in result)
        return vectors

    async def embed_query(self, text: str) -> list[float]:
        return _normalize(await self._call(partial(self._client.embed_query, text)))


def _build_gemini(settings: Settings) -> EmbeddingModel:
    key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
    if not key:
        raise EmbeddingError("GEMINI_API_KEY n'est pas défini")
    return GeminiEmbeddings(settings.embedding_model, key)


_BUILDERS: dict[str, Callable[[Settings], EmbeddingModel]] = {"gemini": _build_gemini}


def create_embeddings(settings: Settings) -> EmbeddingModel | None:
    """Retourne le modèle d'embeddings, ou None s'il n'est pas utilisable (le RAG est alors
    désactivé : l'agent transfère les questions factuelles au lieu de les deviner)."""
    builder = _BUILDERS.get(settings.embedding_provider.lower())
    if builder is None:
        raise EmbeddingError(
            f"Fournisseur d'embeddings inconnu : {settings.embedding_provider!r} "
            f"(disponibles : {sorted(_BUILDERS)})"
        )
    try:
        return builder(settings)
    except EmbeddingError:
        return None
