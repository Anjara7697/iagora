"""Index des requêtes fréquentes (annulation des relances, entonnoir, journal par conversation).

Revision ID: 0008
Revises: 0007
"""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_follow_ups_prospect_id", "follow_ups", ["prospect_id"])
    op.create_index(
        "ix_campaign_prospects_conversion_stage", "campaign_prospects", ["conversion_stage"]
    )
    op.create_index("ix_interactions_conversation_ref", "interactions", ["conversation_ref"])


def downgrade() -> None:
    op.drop_index("ix_interactions_conversation_ref", table_name="interactions")
    op.drop_index("ix_campaign_prospects_conversion_stage", table_name="campaign_prospects")
    op.drop_index("ix_follow_ups_prospect_id", table_name="follow_ups")
