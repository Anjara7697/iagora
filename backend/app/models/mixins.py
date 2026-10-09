from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, func
from sqlalchemy.orm import Mapped, mapped_column


def utc_now_column(*, onupdate: bool = False) -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now() if onupdate else None,
    )


class CreatedAtMixin:
    created_at: Mapped[datetime] = utc_now_column()


class TimestampMixin(CreatedAtMixin):
    # Récupère `updated_at` (valeur calculée par la base) dans le même aller-retour que l'UPDATE :
    # sans cela l'attribut est expiré et son rechargement échoue en contexte async.
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012

    updated_at: Mapped[datetime] = utc_now_column(onupdate=True)


def str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """Colonne texte contrainte par un CHECK, valeurs = `.value` de l'énumération."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        values_callable=lambda e: [m.value for m in e],
        length=32,
    )
