"""Les conversations et messages passent dans MongoDB (CdC §9.5).

Supprime les tables PostgreSQL `conversations` et `messages` et ajoute
`interactions.conversation_ref` (référence vers le document MongoDB). Refuse de s'exécuter si
ces tables contiennent des données : elles doivent d'abord être migrées vers MongoDB.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    for table in ("messages", "conversations"):
        count = bind.execute(sa.text(f"SELECT count(*) FROM {table}")).scalar_one()  # noqa: S608
        if count:
            raise RuntimeError(
                f"La table {table} contient {count} ligne(s) : migrez-les vers MongoDB "
                "avant d'appliquer cette migration (aucune donnée n'est supprimée)."
            )
    op.drop_table("messages")
    op.drop_table("conversations")
    op.add_column("interactions", sa.Column("conversation_ref", sa.String(length=24)))


def downgrade() -> None:
    op.drop_column("interactions", "conversation_ref")
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("prospect_id", sa.Integer(), nullable=False),
        sa.Column("channel_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="open", nullable=False),
        sa.Column("started_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("last_message_at", postgresql.TIMESTAMP(timezone=True)),
        sa.Column("closed_at", postgresql.TIMESTAMP(timezone=True)),
        sa.CheckConstraint(
            "status IN ('open', 'handed_off', 'closed')",
            name=op.f("ck_conversations_conversation_status"),
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["channels.id"], name=op.f("fk_conversations_channel_id_channels")
        ),
        sa.ForeignKeyConstraint(
            ["prospect_id"],
            ["prospects.id"],
            name=op.f("fk_conversations_prospect_id_prospects"),
            ondelete="CASCADE",
        ),
    )
    op.create_index(op.f("ix_conversations_prospect_id"), "conversations", ["prospect_id"])
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("sender_type", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("external_message_id", sa.String(length=255)),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "sender_type IN ('prospect', 'agent', 'advisor')",
            name=op.f("ck_messages_sender_type"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_messages_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "conversation_id", "external_message_id", name=op.f("uq_messages_conversation_id")
        ),
    )
    op.create_index(op.f("ix_messages_conversation_id"), "messages", ["conversation_id"])
