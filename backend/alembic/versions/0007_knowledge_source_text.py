"""Texte source des documents de la base de connaissances (relecture et modification).

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("kb_documents", sa.Column("source_text", sa.Text()))


def downgrade() -> None:
    op.drop_column("kb_documents", "source_text")
