"""create comparisons tables

Revision ID: 003
Revises: 002
Create Date: 2026-07-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "comparisons",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("document_ids", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("synthesis_text", sa.Text, nullable=True),
        sa.Column("agreement_score", sa.Float, nullable=True),
        sa.Column("trust_score", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_comparisons_workspace", "comparisons", ["workspace_id"])
    op.create_index("idx_comparisons_user", "comparisons", ["user_id"])
    op.create_index("idx_comparisons_created", "comparisons", ["created_at"])

    op.create_table(
        "comparison_results",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("comparison_id", sa.String(36), sa.ForeignKey("comparisons.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("answer_text", sa.Text, nullable=False),
        sa.Column("sources", sa.Text, nullable=True, server_default="'[]'"),
        sa.Column("trust_score", sa.Float, nullable=True),
        sa.Column("stance", sa.String(20), nullable=False, server_default="'silent'"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("idx_comparison_results_comparison", "comparison_results", ["comparison_id"])
    op.create_index("idx_comparison_results_document", "comparison_results", ["document_id"])


def downgrade() -> None:
    op.drop_index("idx_comparison_results_document", table_name="comparison_results")
    op.drop_index("idx_comparison_results_comparison", table_name="comparison_results")
    op.drop_table("comparison_results")
    op.drop_index("idx_comparisons_created", table_name="comparisons")
    op.drop_index("idx_comparisons_user", table_name="comparisons")
    op.drop_index("idx_comparisons_workspace", table_name="comparisons")
    op.drop_table("comparisons")