"""Numéros de téléphone au format international E.164 (AUDIT-DATA-001).

Migration de données, rejouable : seuls les numéros qui changent sont réécrits. Les fiches dont les
numéros désigneraient la même personne une fois normalisés (collisions) ne sont PAS modifiées ni
fusionnées : leurs numéros de fiche sont journalisés, à examiner à la main
(`python -m app.cli phone-report`). Pas de retour arrière : l'ancienne saisie n'est pas conservée,
et le format E.164 reste lisible par la version précédente.

Revision ID: 0013
Revises: 0012
"""

import logging

import sqlalchemy as sa
from alembic import context, op
from app.config import get_settings
from app.core import phones

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    if context.is_offline_mode():  # `--sql` : migration de données, sans requête à générer
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, phone FROM prospects WHERE phone IS NOT NULL")).all()
    changes, collisions = phones.plan(
        [(row[0], row[1]) for row in rows], get_settings().phone_default_region
    )
    for prospect_id, phone in changes.items():
        bind.execute(
            sa.text("UPDATE prospects SET phone = :phone WHERE id = :id"),
            {"phone": phone, "id": prospect_id},
        )
    logger.info("Téléphones au format E.164 : %d fiche(s) mise(s) à jour", len(changes))
    for group in collisions:
        logger.warning("Même numéro sur plusieurs fiches, non modifiées : %s", group)


def downgrade() -> None:
    pass  # voir la docstring : rien à défaire
