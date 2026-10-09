"""Mots de passe des utilisateurs (S-06)

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-09 06:29:23.556651
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default temporaire : les comptes éventuellement existants reçoivent un hash vide
    # (aucune connexion possible) ; un administrateur doit leur définir un mot de passe.
    op.add_column(
        "users",
        sa.Column("hashed_password", sa.String(length=255), nullable=False, server_default=""),
    )
    op.alter_column("users", "hashed_password", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "hashed_password")
