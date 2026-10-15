from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin
from app.models.types import EmbeddingType


class KnowledgeDocument(TimestampMixin, Base):
    """Document source de la base de connaissances (RAG, F-14). Un document = un fichier validé."""

    __tablename__ = "kb_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(
        String(120), unique=True
    )  # identifiant stable (nom de fichier)
    title: Mapped[str] = mapped_column(String(255))
    # Programme concerné (code de cible) ; NULL = information valable pour tous les programmes.
    target_code: Mapped[str | None] = mapped_column(String(60))
    content_hash: Mapped[str] = mapped_column(String(64))
    # Modèle d'embedding des vecteurs de ce document : des vecteurs de modèles différents ne sont
    # pas comparables, la recherche ne considère que le modèle courant.
    embedding_model: Mapped[str] = mapped_column(String(120))
    # Document FICTIF de démonstration : jamais interrogé en production.
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )


class KnowledgeChunk(CreatedAtMixin, Base):
    __tablename__ = "kb_chunks"
    __table_args__ = (Index("ix_kb_chunks_document_id", "document_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("kb_documents.id", ondelete="CASCADE"))
    position: Mapped[int]
    heading: Mapped[str | None] = mapped_column(String(255))
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(EmbeddingType())

    document: Mapped[KnowledgeDocument] = relationship(back_populates="chunks")
