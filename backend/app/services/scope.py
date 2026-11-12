"""Cloisonnement des prospects par campagne (AUDIT-SEC-006, décision D-23).

- Administrateur et observateur : voient tout.
- Conseiller : voit les prospects des campagnes dont il est responsable, et ceux qui lui sont
  affectés individuellement dans une autre campagne. Les prospects sans campagne (file
  « À attribuer ») sont réservés à l'administrateur.

Le filtre est appliqué côté serveur, jamais seulement dans la console. Un prospect hors périmètre
répond « introuvable » (404) : son existence n'est pas révélée.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models import Campaign, CampaignProspect, CampaignSource, Prospect, User
from app.models.enums import UserRole
from app.services.errors import NotFoundError


@dataclass(frozen=True)
class Scope:
    """`advisor_id` : périmètre d'un conseiller ; None : aucune restriction."""

    advisor_id: int | None = None

    @property
    def restricted(self) -> bool:
        return self.advisor_id is not None


EVERYTHING = Scope()


def for_user(user: User) -> Scope:
    return Scope(user.id) if user.role is UserRole.ADVISOR else EVERYTHING


def visible_ids(advisor_id: int) -> Select[tuple[int]]:
    """Identifiants des prospects visibles par ce conseiller (sous-requête)."""
    return (
        select(CampaignProspect.prospect_id)
        .join(CampaignSource, CampaignSource.id == CampaignProspect.campaign_source_id)
        .join(Campaign, Campaign.id == CampaignSource.campaign_id)
        .where(
            or_(
                Campaign.responsible_advisor_id == advisor_id,
                CampaignProspect.assigned_advisor_id == advisor_id,
            )
        )
    )


def condition(scope: Scope, column: Any = Prospect.id) -> ColumnElement[bool]:
    """Condition SQL sur une colonne d'identifiant de prospect (`Prospect.id` par défaut)."""
    if scope.advisor_id is None:
        return true()
    return column.in_(visible_ids(scope.advisor_id))  # type: ignore[no-any-return]


async def prospect_ids(session: AsyncSession, scope: Scope) -> list[int] | None:
    """Liste explicite pour filtrer MongoDB (`prospect_id`) ; None : aucune restriction."""
    if scope.advisor_id is None:
        return None
    return sorted(set(await session.scalars(visible_ids(scope.advisor_id))))


def mongo_match(ids: list[int] | None, exclude: list[int] | None = None) -> dict[str, Any]:
    """Filtre MongoDB `prospect_id` à fusionner dans une requête ({} sans restriction) ;
    `exclude` : prospects à écarter (fictifs dans les statistiques)."""
    condition: dict[str, Any] = {}
    if ids is not None:
        condition["$in"] = ids
    if exclude:
        condition["$nin"] = exclude
    return {"prospect_id": condition} if condition else {}


async def ensure_visible(session: AsyncSession, scope: Scope, prospect_id: int) -> None:
    if scope.advisor_id is None:
        return
    visible = await session.scalar(
        select(true()).where(Prospect.id == prospect_id, condition(scope)).limit(1)
    )
    if not visible:
        raise NotFoundError("Prospect introuvable")
