"""Add golden_entries table and queries.edge_case.

Revision ID: 013
Revises: 012
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Filled in by the owning sprint lane (see plan: migration slots).
    pass


def downgrade() -> None:
    pass
