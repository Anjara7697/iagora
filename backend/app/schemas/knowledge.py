from datetime import datetime

from pydantic import BaseModel, Field


class KnowledgeStatus(BaseModel):
    configured: bool = Field(description="Embeddings utilisables (clé présente)")
    embedding_model: str | None = None
    min_score: float
    top_k: int


class DocumentRead(BaseModel):
    slug: str
    title: str
    target_code: str | None
    chunks: int
    embedding_model: str
    is_demo: bool
    updated_at: datetime | None = None
    needs_reindex: bool = Field(description="Vecteurs d'un autre modèle que le modèle courant")


class ChunkRead(BaseModel):
    heading: str | None
    text: str


class DocumentDetailRead(DocumentRead):
    source_text: str | None = None
    sections: list[ChunkRead] = []


class DocumentWrite(BaseModel):
    content: str = Field(min_length=10, max_length=200_000, description="Markdown avec en-tête")


class IngestRead(BaseModel):
    slug: str
    status: str
    chunks: int


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    target_code: str | None = None
    limit: int = Field(6, ge=1, le=10)


class SearchHit(BaseModel):
    source: str
    text: str
    score: float
    retained: bool = Field(description="Atteint le seuil : l'agent pourrait s'en servir")


class SearchResult(BaseModel):
    threshold: float
    results: list[SearchHit]
