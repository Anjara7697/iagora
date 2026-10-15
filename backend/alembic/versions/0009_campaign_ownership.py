"""Responsable de campagne et exceptions d'affectation.

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("responsible_advisor_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_campaigns_responsible_advisor_id_users",
        "campaigns",
        "users",
        ["responsible_advisor_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_campaigns_responsible_advisor_id", "campaigns", ["responsible_advisor_id"])
    op.add_column(
        "campaign_prospects",
        sa.Column(
            "assignment_is_override",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Les affectations individuelles existantes sont des choix explicites à préserver.
    op.execute(
        "UPDATE campaign_prospects SET assignment_is_override = true "
        "WHERE assigned_advisor_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("campaign_prospects", "assignment_is_override")
    op.drop_index("ix_campaigns_responsible_advisor_id", table_name="campaigns")
    op.drop_constraint("fk_campaigns_responsible_advisor_id_users", "campaigns", type_="foreignkey")
    op.drop_column("campaigns", "responsible_advisor_id")
