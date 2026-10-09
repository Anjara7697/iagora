# ruff: noqa: E501
"""Données de référence : canaux et cibles commerciales.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

CHANNELS = [
    ("email", "email"),
    ("facebook", "social"),
    ("instagram", "social"),
    ("linkedin", "social"),
    ("web_form", "web"),
    ("phone", "phone"),
]

# CdC §3.2
TARGETS = [
    ("ebihar_students", "Étudiants eBIHAR", "Étudiants intéressés par le programme eBIHAR."),
    ("compagnons_pros", "Professionnels - Les Compagnons", "Professionnels en montée en compétences."),
    ("master_candidates", "Master eBIHAR - candidats", "Candidats en recherche d'alternance."),
    ("master_companies", "Master eBIHAR - entreprises", "Entreprises susceptibles d'accueillir des apprentis."),
]  # fmt: skip


def upgrade() -> None:
    channels = sa.table("channels", sa.column("name", sa.String), sa.column("type", sa.String))
    targets = sa.table(
        "targets",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.Text),
    )
    op.bulk_insert(channels, [{"name": n, "type": t} for n, t in CHANNELS])
    op.bulk_insert(targets, [{"code": c, "name": n, "description": d} for c, n, d in TARGETS])


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM targets WHERE code IN :codes").bindparams(
            sa.bindparam("codes", [c for c, _, _ in TARGETS], expanding=True)
        )
    )
    op.execute(
        sa.text("DELETE FROM channels WHERE name IN :names").bindparams(
            sa.bindparam("names", [n for n, _ in CHANNELS], expanding=True)
        )
    )
