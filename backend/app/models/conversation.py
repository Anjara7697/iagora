from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import Direction
from app.models.mixins import CreatedAtMixin, str_enum


class Interaction(CreatedAtMixin, Base):
    """Journal des échanges et événements du parcours (F-06, OB-05).

    Conversations et messages : MongoDB (CdC §9.5), voir app/services/conversations.py.
    """

    __tablename__ = "interactions"
    __table_args__ = (
        UniqueConstraint("channel_id", "external_id"),
        Index("ix_interactions_prospect_created", "prospect_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(ForeignKey("prospects.id", ondelete="CASCADE"))
    channel_id: Mapped[int | None] = mapped_column(ForeignKey("channels.id"))
    type: Mapped[str] = mapped_column(String(50))
    direction: Mapped[Direction] = mapped_column(str_enum(Direction, "direction"))
    content: Mapped[str | None] = mapped_column(Text)
    external_id: Mapped[str | None] = mapped_column(String(255))
    intent: Mapped[str | None] = mapped_column(String(100))
    sentiment: Mapped[str | None] = mapped_column(String(50))
    # Référence (ObjectId) de la conversation MongoDB quand l'interaction est un message :
    # le contenu complet n'est stocké qu'à un seul endroit, dans MongoDB.
    conversation_ref: Mapped[str | None] = mapped_column(String(24))
