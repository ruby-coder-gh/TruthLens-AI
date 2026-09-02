"""Add documents.tags JSON.

Revision ID: 011
Revises: 010
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Filled in by the owning sprint lane (see plan: migration slots).
    pass


def downgrade() -> None:
    pass
