"""Add prompt_versions table, queries.prompt_version/prompt_tokens, eval_runs gate columns.

Revision ID: 010
Revises: 009
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Filled in by the owning sprint lane (see plan: migration slots).
    pass


def downgrade() -> None:
    pass
