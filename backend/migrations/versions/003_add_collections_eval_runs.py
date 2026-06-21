"""Add collections, eval_runs, extend users/documents.

Revision ID: 003
Revises: 002
Create Date: 2026-06-21
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Collections ---
    op.create_table(
        "collections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("description", sa.String(1024), server_default=""),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_collections_workspace", "collections", ["workspace_id"])

    # --- Collection Access (many-to-many) ---
    op.create_table(
        "collection_access",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("collection_id", sa.String(36), sa.ForeignKey("collections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("collection_id", "user_id", name="uq_collection_user"),
    )
    op.create_index("idx_ca_collection", "collection_access", ["collection_id"])
    op.create_index("idx_ca_user", "collection_access", ["user_id"])

    # --- Eval Runs ---
    op.create_table(
        "eval_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("faithfulness", sa.Float(), nullable=True),
        sa.Column("context_precision", sa.Float(), nullable=True),
        sa.Column("context_recall", sa.Float(), nullable=True),
        sa.Column("answer_relevance", sa.Float(), nullable=True),
        sa.Column("answer_correctness", sa.Float(), nullable=True),
        sa.Column("refusal_accuracy", sa.Float(), nullable=True),
        sa.Column("golden_set_version", sa.String(64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    # --- Extend users: last_login_at ---
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))

    # --- Extend documents: collection_id + indexed_at ---
    op.add_column("documents", sa.Column("collection_id", sa.String(36), sa.ForeignKey("collections.id", ondelete="SET NULL"), nullable=True))
    op.add_column("documents", sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_docs_collection", "documents", ["collection_id"])

def downgrade() -> None:
    # Remove document columns first
    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_index("idx_docs_collection")
        batch_op.drop_column("indexed_at")
        batch_op.drop_column("collection_id")

    # Remove user column
    op.drop_column("users", "last_login_at")

    # Drop tables
    op.drop_table("eval_runs")
    op.drop_table("collection_access")
    op.drop_table("collections")
