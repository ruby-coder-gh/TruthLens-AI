"""Add query_claims, receipts, radar_scans, contradictions tables.

Shared-contracts scaffold for the Truth Suite sprint (Truth Lens claim
persistence, Truth Receipt, Contradiction Radar). Table creation only — the
lanes owning each feature (L1/L3/L5) fill in the read/write logic.

Revision ID: 015
Revises: 014
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "query_claims",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("query_id", sa.String(length=36), nullable=False, unique=True),
        sa.Column("claims", sa.Text(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["query_id"], ["queries.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "receipts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False, unique=True),
        sa.Column("query_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("canonical", sa.Text(), nullable=False),
        sa.Column("seal", sa.String(length=64), nullable=False),
        sa.Column("signature", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["query_id"], ["queries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_receipts_token", "receipts", ["token"])
    op.create_index("idx_receipts_query", "receipts", ["query_id"])
    op.create_index("idx_receipts_workspace", "receipts", ["workspace_id"])

    op.create_table(
        "radar_scans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("scope", sa.Text(), nullable=True),
        sa.Column("chunks_scanned", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pairs_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("found", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_radar_scans_workspace", "radar_scans", ["workspace_id"])
    op.create_index("idx_radar_scans_workspace_status", "radar_scans", ["workspace_id", "status"])

    op.create_table(
        "contradictions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("scan_id", sa.String(length=36), nullable=True),
        sa.Column("pair_key", sa.String(length=64), nullable=False),
        sa.Column("doc_a_id", sa.String(length=36), nullable=False),
        sa.Column("chunk_a_id", sa.String(length=36), nullable=False),
        sa.Column("sentence_a", sa.Text(), nullable=False),
        sa.Column("doc_b_id", sa.String(length=36), nullable=False),
        sa.Column("chunk_b_id", sa.String(length=36), nullable=False),
        sa.Column("sentence_b", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("similarity", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column("resolved_by", sa.String(length=36), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scan_id"], ["radar_scans.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["doc_a_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["doc_b_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("workspace_id", "pair_key", name="uq_contradictions_workspace_pair"),
    )
    op.create_index("idx_contradictions_workspace", "contradictions", ["workspace_id"])
    op.create_index("idx_contradictions_scan", "contradictions", ["scan_id"])
    op.create_index("idx_contradictions_workspace_status", "contradictions", ["workspace_id", "status"])


def downgrade() -> None:
    op.drop_index("idx_contradictions_workspace_status", table_name="contradictions")
    op.drop_index("idx_contradictions_scan", table_name="contradictions")
    op.drop_index("idx_contradictions_workspace", table_name="contradictions")
    op.drop_table("contradictions")

    op.drop_index("idx_radar_scans_workspace_status", table_name="radar_scans")
    op.drop_index("idx_radar_scans_workspace", table_name="radar_scans")
    op.drop_table("radar_scans")

    op.drop_index("idx_receipts_workspace", table_name="receipts")
    op.drop_index("idx_receipts_query", table_name="receipts")
    op.drop_index("idx_receipts_token", table_name="receipts")
    op.drop_table("receipts")

    op.drop_table("query_claims")
