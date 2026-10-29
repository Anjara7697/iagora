from sqlalchemy import Boolean, ForeignKey, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base
from app.models.mixins import CreatedAtMixin


class ErasureRecord(CreatedAtMixin, Base):
    """Trace d'un effacement (RGPD, art. 17) et liste de suppression.

    Elle ne contient aucune donnée lisible sur la personne : l'identifiant de l'ancienne fiche, le
    motif, l'auteur et, seulement quand il faut continuer à respecter une opposition ou une demande
    d'effacement, l'empreinte (SHA-256 salé) de son email et de son téléphone. Un prospect recréé
    plus tard avec cette adresse naît désinscrit au lieu d'être recontacté.
    """

    __tablename__ = "erasure_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    former_prospect_id: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(20))
    keep_suppressed: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    email_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    phone_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
