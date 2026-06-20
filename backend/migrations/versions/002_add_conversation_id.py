"""Add conversation_id to queries table.

Revision ID: 002
Revises: 001
Create Date: 2026-06-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "queries",
        sa.Column("conversation_id", sa.String(36), nullable=True, index=True),
    )
    op.create_index("idx_queries_conversation", "queries", ["conversation_id"])


def downgrade() -> None:
    op.drop_index("idx_queries_conversation", table_name="queries")
    op.drop_column("queries", "conversation_id")
