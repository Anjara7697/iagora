from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.enums import DuplicateStatus
from app.models.mixins import CreatedAtMixin, str_enum


class DuplicateCandidate(CreatedAtMixin, Base):
    """Deux fiches qui semblent décrire la même personne, à trancher par une personne.

    Repérées quand une réception porte des identifiants rattachés à deux fiches différentes (un
    email sur l'une, un téléphone sur l'autre). Rien n'est fusionné automatiquement : un conseiller
    ou un administrateur fusionne les fiches ou les déclare distinctes. Les identifiants de fiches
    ne sont pas des clés étrangères, pour garder la trace d'une fusion après la suppression de la
    fiche absorbée ; `prospect_id` est toujours le plus petit des deux.
    """

    __tablename__ = "duplicate_candidates"
    __table_args__ = (UniqueConstraint("prospect_id", "other_prospect_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    prospect_id: Mapped[int] = mapped_column(Integer, index=True)
    other_prospect_id: Mapped[int] = mapped_column(Integer, index=True)
    # Identifiants partagés, ex. « email, phone » (aucune valeur personnelle).
    matched_fields: Mapped[str] = mapped_column(String(100))
    status: Mapped[DuplicateStatus] = mapped_column(
        str_enum(DuplicateStatus, "duplicate_status"),
        default=DuplicateStatus.PENDING,
        server_default=DuplicateStatus.PENDING.value,
        index=True,
    )
    kept_prospect_id: Mapped[int | None] = mapped_column(Integer)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
