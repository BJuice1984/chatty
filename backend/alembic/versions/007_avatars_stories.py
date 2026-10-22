"""Avatars on users/chats and the stories/story_views tables.

Global media (avatars, story images) stores File rows with a NULL chat_id,
so files.chat_id becomes nullable. batch_alter_table keeps the migration
runnable on SQLite while staying a no-op wrapper on PostgreSQL.

Revision ID: 007_avatars_stories
Revises: 006_chat_last_reads
Create Date: 2026-10-22
"""

from alembic import op
import sqlalchemy as sa

revision = '007_avatars_stories'
down_revision = '006_chat_last_reads'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('files') as batch:
        batch.alter_column('chat_id', existing_type=sa.Integer(), nullable=True)

    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('avatar_file_id', sa.Integer(), nullable=True))
        batch.create_foreign_key(
            'fk_users_avatar_file_id',
            'files',
            ['avatar_file_id'],
            ['id'],
            ondelete='SET NULL',
        )

    with op.batch_alter_table('chats') as batch:
        batch.add_column(sa.Column('avatar_file_id', sa.Integer(), nullable=True))
        batch.create_foreign_key(
            'fk_chats_avatar_file_id',
            'files',
            ['avatar_file_id'],
            ['id'],
            ondelete='SET NULL',
        )

    op.create_table(
        'stories',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True),
        sa.Column('file_id', sa.Integer(), sa.ForeignKey('files.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        'story_views',
        sa.Column('story_id', sa.Integer(), sa.ForeignKey('stories.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('viewed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('story_views')
    op.drop_table('stories')

    with op.batch_alter_table('chats') as batch:
        batch.drop_constraint('fk_chats_avatar_file_id', type_='foreignkey')
        batch.drop_column('avatar_file_id')

    with op.batch_alter_table('users') as batch:
        batch.drop_constraint('fk_users_avatar_file_id', type_='foreignkey')
        batch.drop_column('avatar_file_id')

    with op.batch_alter_table('files') as batch:
        batch.alter_column('chat_id', existing_type=sa.Integer(), nullable=False)
