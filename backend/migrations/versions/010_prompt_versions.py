"""Add queries.prompt_tokens.

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
    op.add_column("queries", sa.Column("prompt_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("queries") as batch_op:
        batch_op.drop_column("prompt_tokens")
