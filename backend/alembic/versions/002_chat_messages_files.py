"""Add chats, membership, messages and private file metadata."""

from alembic import op
import sqlalchemy as sa


revision = '002_chat_messages_files'
down_revision = '001_users'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'chats',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('is_ai', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_chats_owner_id', 'chats', ['owner_id'], unique=False)

    op.create_table(
        'chat_members',
        sa.Column('chat_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('joined_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('chat_id', 'user_id'),
    )
    op.create_index('ix_chat_members_user_id', 'chat_members', ['user_id'], unique=False)

    op.create_table(
        'files',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('chat_id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('object_key', sa.String(length=512), nullable=False),
        sa.Column('original_name', sa.String(length=255), nullable=False),
        sa.Column('content_type', sa.String(length=255), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('object_key'),
    )
    op.create_index('ix_files_chat_id', 'files', ['chat_id'], unique=False)
    op.create_index('ix_files_owner_id', 'files', ['owner_id'], unique=False)

    op.create_table(
        'messages',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('chat_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('file_id', sa.Integer(), nullable=True),
        sa.Column('client_message_id', sa.String(length=128), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('chat_id', 'user_id', 'client_message_id', name='uq_messages_sender_client_id'),
    )
    op.create_index('ix_messages_chat_id', 'messages', ['chat_id'], unique=False)
    op.create_index('ix_messages_user_id', 'messages', ['user_id'], unique=False)
    op.create_index('ix_messages_file_id', 'messages', ['file_id'], unique=False)
    op.create_index('ix_messages_chat_created_id', 'messages', ['chat_id', 'created_at', 'id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_messages_chat_created_id', table_name='messages')
    op.drop_index('ix_messages_file_id', table_name='messages')
    op.drop_index('ix_messages_user_id', table_name='messages')
    op.drop_index('ix_messages_chat_id', table_name='messages')
    op.drop_table('messages')
    op.drop_index('ix_files_owner_id', table_name='files')
    op.drop_index('ix_files_chat_id', table_name='files')
    op.drop_table('files')
    op.drop_index('ix_chat_members_user_id', table_name='chat_members')
    op.drop_table('chat_members')
    op.drop_index('ix_chats_owner_id', table_name='chats')
    op.drop_table('chats')
