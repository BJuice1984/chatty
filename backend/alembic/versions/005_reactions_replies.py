"""Add message reactions and self-referencing message replies."""

from alembic import op
import sqlalchemy as sa


revision = '005_reactions_replies'
down_revision = '004_bot_runs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'reactions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('message_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('emoji', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id', 'user_id', 'emoji', name='uq_reactions_message_user_emoji'),
    )
    op.create_index('ix_reactions_message_id', 'reactions', ['message_id'], unique=False)
    op.create_index('ix_reactions_user_id', 'reactions', ['user_id'], unique=False)

    op.add_column('messages', sa.Column('reply_to_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_messages_reply_to', 'messages', 'messages', ['reply_to_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_messages_reply_to', 'messages', type_='foreignkey')
    op.drop_column('messages', 'reply_to_id')
    op.drop_index('ix_reactions_user_id', table_name='reactions')
    op.drop_index('ix_reactions_message_id', table_name='reactions')
    op.drop_table('reactions')
