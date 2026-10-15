import logging
from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.integrations.embeddings.base import EmbeddingError
from app.integrations.embeddings.factory import create_embeddings
from app.integrations.knowledge.pg_knowledge import PgKnowledgeBase

logger = logging.getLogger(__name__)


def create_knowledge_base(
    settings: Settings, session_factory: Callable[[], AsyncSession]
) -> PgKnowledgeBase | None:
    """Base de connaissances RAG, ou None si les embeddings ne sont pas utilisables (clé absente,
    fournisseur inconnu) : l'appelant garde alors une base vide, l'agent transfère."""
    try:
        embeddings = create_embeddings(settings)
    except EmbeddingError as exc:
        logger.error("RAG désactivé : %s", exc)
        return None
    if embeddings is None:
        logger.warning("RAG désactivé : embeddings non configurés (clé absente)")
        return None
    return PgKnowledgeBase(
        session_factory,
        embeddings,
        min_score=settings.rag_min_score,
        # Les documents fictifs de démonstration ne sont jamais servis en production.
        include_demo=settings.environment != "production",
    )
