"""Motif et auteur d'un changement de consentement (décision D-20).

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("consent_events", sa.Column("reason", sa.Text(), nullable=True))
    op.add_column(
        "consent_events",
        sa.Column(
            "actor_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_consent_events_actor_user_id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_consent_events_actor_user_id", "consent_events", type_="foreignkey")
    op.drop_column("consent_events", "actor_user_id")
    op.drop_column("consent_events", "reason")
