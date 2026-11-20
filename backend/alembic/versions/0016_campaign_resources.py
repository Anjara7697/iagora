"""Ressources de campagne et objet d'email imposé (décision D-39).

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("email_subject", sa.String(200), nullable=True))
    op.add_column(
        "campaigns",
        sa.Column("resources", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("campaigns", "resources")
    op.drop_column("campaigns", "email_subject")
