"""Add query collaboration, review queue, and annotation persistence.

Revision ID: 008
Revises: 007
Create Date: 2026-07-19
"""

from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspaces", sa.Column("review_queue_enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")))

    op.add_column("queries", sa.Column("compared_to_query_id", sa.String(length=36), nullable=True))
    op.add_column("queries", sa.Column("trust_components", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.add_column("queries", sa.Column("review_status", sa.String(length=32), nullable=False, server_default="needs_review"))
    op.add_column("queries", sa.Column("review_note", sa.Text(), nullable=True))
    op.add_column("queries", sa.Column("reviewed_by", sa.String(length=36), nullable=True))
    op.add_column("queries", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_queries_compared_to", "queries", ["compared_to_query_id"])
    op.create_index("idx_queries_review_status", "queries", ["review_status"])
    op.create_index("idx_queries_reviewed_by", "queries", ["reviewed_by"])
    op.create_index("idx_queries_review_queue", "queries", ["workspace_id", "review_status", "trust_score"])

    op.create_table(
        "query_pins",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("query_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["query_id"], ["queries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "query_id", name="uq_query_pins_user_query"),
    )
    op.create_index("idx_query_pins_workspace", "query_pins", ["workspace_id"])
    op.create_index("idx_query_pins_query", "query_pins", ["query_id"])
    op.create_index("idx_query_pins_user", "query_pins", ["user_id"])
    op.create_index("idx_query_pins_user_workspace", "query_pins", ["user_id", "workspace_id"])

    op.create_table(
        "annotations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("query_id", sa.String(length=36), nullable=True),
        sa.Column("source_id", sa.String(length=128), nullable=True),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.String(length=36), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["query_id"], ["queries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_annotations_workspace", "annotations", ["workspace_id"])
    op.create_index("idx_annotations_query", "annotations", ["query_id"])
    op.create_index("idx_annotations_source", "annotations", ["source_id"])
    op.create_index("idx_annotations_user", "annotations", ["user_id"])
    op.create_index("idx_annotations_deleted_at", "annotations", ["deleted_at"])
    op.create_index("idx_annotations_workspace_query", "annotations", ["workspace_id", "query_id", "created_at"])
    op.create_index("idx_annotations_query_source", "annotations", ["query_id", "source_id"])


def downgrade() -> None:
    op.drop_index("idx_annotations_query_source", table_name="annotations")
    op.drop_index("idx_annotations_workspace_query", table_name="annotations")
    op.drop_index("idx_annotations_deleted_at", table_name="annotations")
    op.drop_index("idx_annotations_user", table_name="annotations")
    op.drop_index("idx_annotations_source", table_name="annotations")
    op.drop_index("idx_annotations_query", table_name="annotations")
    op.drop_index("idx_annotations_workspace", table_name="annotations")
    op.drop_table("annotations")

    op.drop_index("idx_query_pins_user_workspace", table_name="query_pins")
    op.drop_index("idx_query_pins_user", table_name="query_pins")
    op.drop_index("idx_query_pins_query", table_name="query_pins")
    op.drop_index("idx_query_pins_workspace", table_name="query_pins")
    op.drop_table("query_pins")

    op.drop_index("idx_queries_review_queue", table_name="queries")
    op.drop_index("idx_queries_reviewed_by", table_name="queries")
    op.drop_index("idx_queries_review_status", table_name="queries")
    op.drop_index("idx_queries_compared_to", table_name="queries")
    op.drop_column("queries", "reviewed_at")
    op.drop_column("queries", "reviewed_by")
    op.drop_column("queries", "review_note")
    op.drop_column("queries", "review_status")
    op.drop_column("queries", "trust_components")
    op.drop_column("queries", "compared_to_query_id")
    op.drop_column("workspaces", "review_queue_enabled")
