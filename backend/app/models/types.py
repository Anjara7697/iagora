"""Types de colonnes spécifiques."""

from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator, TypeEngine

# Dimension des vecteurs stockés. La changer exige une migration ET une ré-indexation complète.
EMBEDDING_DIMENSIONS = 768


class EmbeddingType(TypeDecorator[list[float]]):
    """Vecteur d'embedding : type `vector` de pgvector sur PostgreSQL, JSON ailleurs.

    Le repli JSON ne sert qu'aux tests locaux (SQLite) : la similarité est alors calculée en Python.
    """

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(EMBEDDING_DIMENSIONS))
        return dialect.type_descriptor(JSON())

    def process_result_value(self, value: Any, dialect: Dialect) -> list[float] | None:
        return None if value is None else [float(x) for x in value]
