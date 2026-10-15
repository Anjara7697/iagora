"""Base de connaissances RAG : recherche sémantique dans PostgreSQL (pgvector).

Garde-fous (NF-10) :
- seuil de pertinence : un extrait en dessous de `min_score` n'est jamais renvoyé ;
- uniquement les vecteurs du modèle d'embedding courant (jamais de comparaison entre modèles) ;
- les documents de démonstration (fictifs) sont exclus en production ;
- toute panne des embeddings ⇒ aucun extrait ⇒ l'agent transfère au conseiller au lieu de deviner.
"""

import logging
import math
from collections.abc import Callable

from sqlalchemy import Float, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from app.graph.ports import Passage
from app.integrations.embeddings.base import EmbeddingError, EmbeddingModel
from app.models import KnowledgeChunk, KnowledgeDocument

logger = logging.getLogger(__name__)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class PgKnowledgeBase:
    def __init__(
        self,
        session_factory: Callable[[], AsyncSession],
        embeddings: EmbeddingModel,
        *,
        min_score: float,
        include_demo: bool,
    ) -> None:
        self._session_factory = session_factory
        self._embeddings = embeddings
        self.min_score = min_score
        self._include_demo = include_demo

    def _filters(self, target_code: str | None) -> list[ColumnElement[bool]]:
        filters: list[ColumnElement[bool]] = [
            KnowledgeDocument.embedding_model == self._embeddings.model_id
        ]
        if not self._include_demo:
            filters.append(KnowledgeDocument.is_demo.is_(False))
        if target_code:  # le programme du prospect + les informations générales
            filters.append(
                or_(
                    KnowledgeDocument.target_code.is_(None),
                    KnowledgeDocument.target_code == target_code,
                )
            )
        return filters

    async def search(self, query: str, target_code: str | None, limit: int = 4) -> list[Passage]:
        passages = await self.search_all(query, target_code, limit)
        return [p for p in passages if (p.score or 0.0) >= self.min_score]

    async def search_all(
        self, query: str, target_code: str | None, limit: int = 4
    ) -> list[Passage]:
        """Les meilleurs extraits SANS appliquer le seuil (diagnostic : `kb-search`, `kb-eval`)."""
        if not query.strip():
            return []
        try:
            vector = await self._embeddings.embed_query(query)
        except EmbeddingError as exc:
            logger.warning("Recherche impossible, embeddings indisponibles : %s", exc)
            return []
        async with self._session_factory() as session:
            scored = await self._scored(session, vector, target_code, limit)
        return [
            Passage(
                source=f"{doc.title} / {chunk.heading or 'général'}", text=chunk.text, score=score
            )
            for chunk, doc, score in scored
        ]

    async def _scored(
        self, session: AsyncSession, vector: list[float], target_code: str | None, limit: int
    ) -> list[tuple[KnowledgeChunk, KnowledgeDocument, float]]:
        filters = self._filters(target_code)
        if session.get_bind().dialect.name == "postgresql":
            distance = KnowledgeChunk.embedding.op("<=>", return_type=Float)(vector)
            rows = await session.execute(
                select(KnowledgeChunk, KnowledgeDocument, (1 - distance).label("score"))
                .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
                .where(*filters)
                .order_by(distance)
                .limit(limit)
            )
            return [(c, d, float(s)) for c, d, s in rows]
        # Repli sans pgvector (tests locaux sur SQLite) : similarité calculée en Python.
        rows = await session.execute(
            select(KnowledgeChunk, KnowledgeDocument)
            .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
            .where(*filters)
        )
        ranked = [(c, d, _cosine(vector, c.embedding)) for c, d in rows]
        return sorted(ranked, key=lambda t: t[2], reverse=True)[:limit]
