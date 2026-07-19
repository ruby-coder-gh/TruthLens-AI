"""Add durable investigation cases and review state.

Revision ID: 006
Revises: 005
Create Date: 2026-07-19
"""

from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "investigations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("query_text", sa.Text(), nullable=False),
        sa.Column("final_report", sa.Text(), nullable=False, server_default=""),
        sa.Column("sub_questions", sa.JSON(), nullable=False),
        sa.Column("reasoning_trace", sa.JSON(), nullable=False),
        sa.Column("trust_components", sa.JSON(), nullable=False),
        sa.Column("trust_score", sa.Float(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("review_status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.String(length=36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_investigations_workspace", "investigations", ["workspace_id"])
    op.create_index("idx_investigations_user", "investigations", ["user_id"])
    op.create_index("idx_investigations_reviewed_by", "investigations", ["reviewed_by"])
    op.create_index("idx_investigations_workspace_created", "investigations", ["workspace_id", "created_at"])
    op.create_index("idx_investigations_review_status", "investigations", ["review_status"])


def downgrade() -> None:
    op.drop_index("idx_investigations_review_status", table_name="investigations")
    op.drop_index("idx_investigations_workspace_created", table_name="investigations")
    op.drop_index("idx_investigations_reviewed_by", table_name="investigations")
    op.drop_index("idx_investigations_user", table_name="investigations")
    op.drop_index("idx_investigations_workspace", table_name="investigations")
    op.drop_table("investigations")
