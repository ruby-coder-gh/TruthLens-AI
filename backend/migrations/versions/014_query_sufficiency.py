"""Persist the sufficiency verdict behind an abstention.

The verdict (searched/document counts and top evidence score) is what the
abstention card explains itself with. It was streamed on the `complete` frame
but never stored, so the cache-replay path could only repeat `edge_case` and
the replayed card lost its explanation.

Revision ID: 014
Revises: 013
Create Date: 2026-09-03
"""

from alembic import op
import sqlalchemy as sa


revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL for every generated answer — only a gated abstention has a verdict.
    op.add_column("queries", sa.Column("sufficiency", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("queries") as batch_op:
        batch_op.drop_column("sufficiency")
