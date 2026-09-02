"""Add chunk_quarantines table and documents.quarantined_chunk_count.

Revision ID: 012
Revises: 011
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Filled in by the owning sprint lane (see plan: migration slots).
    pass


def downgrade() -> None:
    pass
