"""Traçabilité des scores et des étapes : valeur résultante et auteur (OB-05, F-11, F-13).

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default temporaire pour les lignes éventuellement existantes.
    op.add_column(
        "score_events",
        sa.Column("new_value", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("score_events", "new_value", server_default=None)
    op.add_column("score_events", sa.Column("actor_user_id", sa.Integer()))
    op.create_foreign_key(
        op.f("fk_score_events_actor_user_id_users"),
        "score_events",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("stage_events", sa.Column("actor_user_id", sa.Integer()))
    op.create_foreign_key(
        op.f("fk_stage_events_actor_user_id_users"),
        "stage_events",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_stage_events_actor_user_id_users"), "stage_events", type_="foreignkey"
    )
    op.drop_column("stage_events", "actor_user_id")
    op.drop_constraint(
        op.f("fk_score_events_actor_user_id_users"), "score_events", type_="foreignkey"
    )
    op.drop_column("score_events", "actor_user_id")
    op.drop_column("score_events", "new_value")
