"""File des doublons de prospects à trancher (fusion manuelle).

Revision ID: 0017
Revises: 0016
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

STATUSES = ("pending", "merged", "distinct")


def upgrade() -> None:
    op.create_table(
        "duplicate_candidates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("prospect_id", sa.Integer(), nullable=False),
        sa.Column("other_prospect_id", sa.Integer(), nullable=False),
        sa.Column("matched_fields", sa.String(100), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                *STATUSES,
                name="duplicate_status",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("kept_prospect_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by_user_id",
            sa.Integer(),
            sa.ForeignKey(
                "users.id",
                ondelete="SET NULL",
                name=op.f("fk_duplicate_candidates_resolved_by_user_id_users"),
            ),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_duplicate_candidates")),
        sa.UniqueConstraint(
            "prospect_id", "other_prospect_id", name=op.f("uq_duplicate_candidates_prospect_id")
        ),
    )
    op.create_index("ix_duplicate_candidates_prospect_id", "duplicate_candidates", ["prospect_id"])
    op.create_index(
        "ix_duplicate_candidates_other_prospect_id", "duplicate_candidates", ["other_prospect_id"]
    )
    op.create_index("ix_duplicate_candidates_status", "duplicate_candidates", ["status"])


def downgrade() -> None:
    op.drop_index("ix_duplicate_candidates_status", table_name="duplicate_candidates")
    op.drop_index("ix_duplicate_candidates_other_prospect_id", table_name="duplicate_candidates")
    op.drop_index("ix_duplicate_candidates_prospect_id", table_name="duplicate_candidates")
    op.drop_table("duplicate_candidates")
