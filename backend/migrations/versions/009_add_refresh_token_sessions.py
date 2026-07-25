"""Add persistent refresh-token sessions for rotation and revocation.

Revision ID: 009
Revises: 008
Create Date: 2026-07-25
"""

from alembic import op
import sqlalchemy as sa


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "refresh_token_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(length=64), nullable=True),
        sa.Column("replaced_by_id", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_refresh_token_sessions_user_id", "refresh_token_sessions", ["user_id"])
    op.create_index(
        "idx_refresh_token_sessions_user_active",
        "refresh_token_sessions",
        ["user_id", "revoked_at"],
    )
    op.create_index(
        "idx_refresh_token_sessions_expires_at",
        "refresh_token_sessions",
        ["expires_at"],
    )
    op.create_index(
        "idx_refresh_token_sessions_replaced_by",
        "refresh_token_sessions",
        ["replaced_by_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_refresh_token_sessions_replaced_by", table_name="refresh_token_sessions")
    op.drop_index("idx_refresh_token_sessions_expires_at", table_name="refresh_token_sessions")
    op.drop_index("idx_refresh_token_sessions_user_active", table_name="refresh_token_sessions")
    op.drop_index("ix_refresh_token_sessions_user_id", table_name="refresh_token_sessions")
    op.drop_table("refresh_token_sessions")
