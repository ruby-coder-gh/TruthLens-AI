"""Add workspace-versioned query cache fields.

Revision ID: 007
Revises: 006
Create Date: 2026-07-19
"""

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column("document_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("queries", sa.Column("normalized_query", sa.Text(), nullable=True))
    op.add_column(
        "queries",
        sa.Column("document_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "queries",
        sa.Column("cache_hit_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "idx_queries_cache_lookup",
        "queries",
        ["workspace_id", "normalized_query", "document_version", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_queries_cache_lookup", table_name="queries")
    op.drop_column("queries", "cache_hit_count")
    op.drop_column("queries", "document_version")
    op.drop_column("queries", "normalized_query")
    op.drop_column("workspaces", "document_version")
