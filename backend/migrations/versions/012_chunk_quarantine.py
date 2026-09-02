"""Add chunk_quarantines table and documents.quarantined_chunk_count.

Ingest-time prompt-injection quarantine (F7a): chunks flagged by
detect_injection() at ingestion time never reach Chroma/BM25. They are
persisted here for human review with a release/dismiss workflow.

Revision ID: 012
Revises: 011
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chunk_quarantines",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("pattern", sa.String(length=64), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="quarantined"),
        sa.Column("reviewed_by", sa.String(length=36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_chunk_quarantines_document", "chunk_quarantines", ["document_id"])
    op.create_index("idx_chunk_quarantines_workspace", "chunk_quarantines", ["workspace_id"])
    op.create_index("idx_chunk_quarantines_status", "chunk_quarantines", ["status"])
    op.create_index(
        "idx_chunk_quarantines_workspace_status", "chunk_quarantines", ["workspace_id", "status"]
    )

    op.add_column(
        "documents",
        sa.Column("quarantined_chunk_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("documents", "quarantined_chunk_count")
    op.drop_index("idx_chunk_quarantines_workspace_status", table_name="chunk_quarantines")
    op.drop_index("idx_chunk_quarantines_status", table_name="chunk_quarantines")
    op.drop_index("idx_chunk_quarantines_workspace", table_name="chunk_quarantines")
    op.drop_index("idx_chunk_quarantines_document", table_name="chunk_quarantines")
    op.drop_table("chunk_quarantines")
