"""Add durable bot runs for the stage-9 AI bot."""

from alembic import op
import sqlalchemy as sa


revision = '004_bot_runs'
down_revision = '003_documents_chunks'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'bot_runs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('chat_id', sa.Integer(), nullable=False),
        sa.Column('message_id', sa.Integer(), nullable=False),
        sa.Column('bot_user_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='queued'),
        sa.Column('attempt', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_kind', sa.String(length=64), nullable=True),
        sa.Column('response_message_id', sa.Integer(), nullable=True),
        sa.Column('attachment_file_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['bot_user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['response_message_id'], ['messages.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['attachment_file_id'], ['files.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id', name='uq_bot_runs_message'),
    )
    op.create_index('ix_bot_runs_chat_id', 'bot_runs', ['chat_id'], unique=False)
    op.create_index('ix_bot_runs_chat_status', 'bot_runs', ['chat_id', 'status'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_bot_runs_chat_status', table_name='bot_runs')
    op.drop_index('ix_bot_runs_chat_id', table_name='bot_runs')
    op.drop_table('bot_runs')
