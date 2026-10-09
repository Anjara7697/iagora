"""Port d'embeddings : transformer du texte en vecteur pour la recherche sémantique (RAG)."""

from collections.abc import Sequence
from typing import Protocol


class EmbeddingError(Exception):
    """Embeddings indisponibles (clé absente, quota, réseau)."""


class EmbeddingModel(Protocol):
    @property
    def model_id(self) -> str:
        """Identifiant stocké avec les vecteurs (`fournisseur/modèle`)."""
        ...

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...
