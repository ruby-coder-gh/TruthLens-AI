"""Add promoted golden-set entries and the query edge_case marker.

Revision ID: 013
Revises: 012
Create Date: 2026-09-02
"""

from alembic import op
import sqlalchemy as sa


revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "golden_entries",
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
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("reference_answer", sa.Text(), nullable=False),
        sa.Column("source_documents", sa.JSON(), nullable=False),
        sa.Column("expected_grounding", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("category", sa.String(length=32), nullable=False, server_default="answerable"),
        sa.Column("difficulty", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("notes", sa.Text(), nullable=True),
        # Approval gate: a promotion is inert until an admin approves it. Any
        # authenticated user can own a workspace and therefore reach
        # promote-golden, and promoted rows feed the eval gate that decides
        # whether an admin may promote a system prompt.
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("approved_by", sa.String(length=36), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_query_id", sa.String(length=36), nullable=True),
        sa.Column("workspace_id", sa.String(length=36), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(["source_query_id"], ["queries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        # One golden entry per reviewed answer; re-promotion is a 409.
        sa.UniqueConstraint("source_query_id", name="uq_golden_entries_source_query"),
    )
    op.create_index("ix_golden_entries_workspace_id", "golden_entries", ["workspace_id"])
    op.create_index("ix_golden_entries_created_by", "golden_entries", ["created_by"])
    op.create_index("idx_golden_entries_category", "golden_entries", ["category"])
    op.create_index("idx_golden_entries_created", "golden_entries", ["created_at"])

    # NULL = a normal generated answer; "insufficient_evidence" = the
    # evidence-sufficiency gate abstained before any LLM call.
    op.add_column("queries", sa.Column("edge_case", sa.String(length=32), nullable=True))
    op.create_index("ix_queries_edge_case", "queries", ["edge_case"])


def downgrade() -> None:
    op.drop_index("ix_queries_edge_case", table_name="queries")
    with op.batch_alter_table("queries") as batch_op:
        batch_op.drop_column("edge_case")

    op.drop_index("idx_golden_entries_created", table_name="golden_entries")
    op.drop_index("idx_golden_entries_category", table_name="golden_entries")
    op.drop_index("ix_golden_entries_created_by", table_name="golden_entries")
    op.drop_index("ix_golden_entries_workspace_id", table_name="golden_entries")
    op.drop_table("golden_entries")
