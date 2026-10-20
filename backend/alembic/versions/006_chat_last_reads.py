"""Add chat last reads for unread counters.

Revision ID: 006_chat_last_reads
Revises: 005_reactions_replies
Create Date: 2026-10-20
"""

from alembic import op
import sqlalchemy as sa

revision = '006_chat_last_reads'
down_revision = '005_reactions_replies'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'chat_last_reads',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chat_id', sa.Integer(), sa.ForeignKey('chats.id', ondelete='CASCADE'), nullable=False),
        sa.Column('last_read_message_id', sa.Integer(), nullable=False, server_default='0'),
        sa.UniqueConstraint('user_id', 'chat_id', name='uq_chat_last_reads_user_chat'),
    )


def downgrade() -> None:
    op.drop_table('chat_last_reads')
