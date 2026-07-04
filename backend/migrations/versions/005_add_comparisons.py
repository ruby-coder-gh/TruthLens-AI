"""Add comparisons tables.

Revision ID: 005
Revises: 004
Create Date: 2026-07-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


# revision identifiers, used by Alembic.
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create comparisons table
    op.create_table(
        'comparisons',
        sa.Column('id', UUID(as_uuid=False), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('workspace_id', UUID(as_uuid=False), nullable=False),
        sa.Column('user_id', UUID(as_uuid=False), nullable=True),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('document_ids', JSONB(), nullable=False, server_default='[]'),
        sa.Column('synthesis_text', sa.Text(), nullable=True),
        sa.Column('agreement_score', sa.Float(), nullable=True),
        sa.Column('trust_score', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('idx_comparisons_workspace', 'comparisons', ['workspace_id'])
    op.create_index('idx_comparisons_user', 'comparisons', ['user_id'])
    op.create_index('idx_comparisons_created', 'comparisons', ['created_at'])

    # Create comparison_results table
    op.create_table(
        'comparison_results',
        sa.Column('id', UUID(as_uuid=False), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('comparison_id', UUID(as_uuid=False), nullable=False),
        sa.Column('document_id', UUID(as_uuid=False), nullable=False),
        sa.Column('answer_text', sa.Text(), nullable=False),
        sa.Column('sources', sa.Text(), nullable=True, server_default='[]'),
        sa.Column('trust_score', sa.Float(), nullable=True),
        sa.Column('stance', sa.String(length=20), nullable=False, server_default='silent'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['comparison_id'], ['comparisons.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
    )
    op.create_index('idx_comparison_results_comparison', 'comparison_results', ['comparison_id'])
    op.create_index('idx_comparison_results_document', 'comparison_results', ['document_id'])


def downgrade() -> None:
    op.drop_index('idx_comparison_results_document', table_name='comparison_results')
    op.drop_index('idx_comparison_results_comparison', table_name='comparison_results')
    op.drop_table('comparison_results')
    op.drop_index('idx_comparisons_created', table_name='comparisons')
    op.drop_index('idx_comparisons_user', table_name='comparisons')
    op.drop_index('idx_comparisons_workspace', table_name='comparisons')
    op.drop_table('comparisons')