"""Effacements RGPD et liste de suppression (empreintes uniquement).

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "erasure_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("former_prospect_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("keep_suppressed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("email_hash", sa.String(64), nullable=True),
        sa.Column("phone_hash", sa.String(64), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_erasure_records_email_hash", "erasure_records", ["email_hash"])
    op.create_index("ix_erasure_records_phone_hash", "erasure_records", ["phone_hash"])


def downgrade() -> None:
    op.drop_index("ix_erasure_records_phone_hash", table_name="erasure_records")
    op.drop_index("ix_erasure_records_email_hash", table_name="erasure_records")
    op.drop_table("erasure_records")
