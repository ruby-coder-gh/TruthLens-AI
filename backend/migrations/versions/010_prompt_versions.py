"""Add prompt version pinning, eval-gated promotion and token accounting.

Revision ID: 010
Revises: 009
Create Date: 2026-09-02
"""

from alembic import op
import sqlalchemy as sa


revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Versioned, content-addressed system prompts ---
    op.create_table(
        "prompt_versions",
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
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
        sa.Column("model_name", sa.String(length=64), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("eval_run_id", sa.String(length=36), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["eval_run_id"], ["eval_runs.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("name", "version", name="uq_prompt_versions_name_version"),
    )
    op.create_index("ix_prompt_versions_name", "prompt_versions", ["name"])
    op.create_index("idx_prompt_versions_name_status", "prompt_versions", ["name", "status"])

    # --- Queries: which prompt produced the answer + real token accounting ---
    op.add_column("queries", sa.Column("prompt_tokens", sa.Integer(), nullable=True))
    op.add_column("queries", sa.Column("prompt_version", sa.String(length=16), nullable=True))
    op.create_index("idx_queries_prompt_version", "queries", ["prompt_version"])
    op.create_index("idx_queries_model_created", "queries", ["model_used", "created_at"])

    # --- Eval runs: promotion gate state ---
    # `status` defaults to `passed` so rows written before this migration keep
    # reading as completed successful runs on the analytics dashboard.
    # `prompt_version_id` is intentionally NOT a foreign key: `prompt_versions.
    # eval_run_id` already points the other way and SQLite cannot ALTER a table
    # to add the deferred constraint a two-way cycle would need.
    op.add_column(
        "eval_runs",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="passed"),
    )
    op.add_column("eval_runs", sa.Column("prompt_version_id", sa.String(length=36), nullable=True))
    op.add_column("eval_runs", sa.Column("model_used", sa.String(length=64), nullable=True))
    op.add_column("eval_runs", sa.Column("subset", sa.String(length=8), nullable=True))
    op.add_column("eval_runs", sa.Column("verdict", sa.Text(), nullable=True))
    op.create_index("idx_eval_runs_prompt_version", "eval_runs", ["prompt_version_id"])
    op.create_index("idx_eval_runs_status", "eval_runs", ["status"])


def downgrade() -> None:
    with op.batch_alter_table("eval_runs") as batch_op:
        batch_op.drop_index("idx_eval_runs_status")
        batch_op.drop_index("idx_eval_runs_prompt_version")
        batch_op.drop_column("verdict")
        batch_op.drop_column("subset")
        batch_op.drop_column("model_used")
        batch_op.drop_column("prompt_version_id")
        batch_op.drop_column("status")

    with op.batch_alter_table("queries") as batch_op:
        batch_op.drop_index("idx_queries_model_created")
        batch_op.drop_index("idx_queries_prompt_version")
        batch_op.drop_column("prompt_version")
        batch_op.drop_column("prompt_tokens")

    op.drop_index("idx_prompt_versions_name_status", table_name="prompt_versions")
    op.drop_index("ix_prompt_versions_name", table_name="prompt_versions")
    op.drop_table("prompt_versions")
