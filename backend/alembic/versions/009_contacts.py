"""Contacts address book and the chats.is_dm DM marker.

contacts is a one-directional address book: the composite PK
(owner_id, contact_user_id) both FK users.id ON DELETE CASCADE, so deleting
a user removes their rows on both sides; created_at is server-defaulted
now. chats.is_dm marks a get-or-create 1:1 chat — additive, NOT NULL,
server_default '0' so existing rows backfill as plain chats.

batch_alter_table keeps the column change runnable on SQLite while staying
a no-op wrapper on PostgreSQL (the 007 precedent). A full-chain SQLite run
stays impossible by design — 008 executes CREATE EXTENSION pg_trgm and 005
uses an ALTER-based create_foreign_key, both PG-only — so both directions
of THIS segment are proven inside pytest
(tests/integration/test_migration_009_contacts_segment.py); the full chain
keeps its operational proof on the compose PostgreSQL
(docs/deployment/own-backend.md).

Revision ID: 009_contacts
Revises: 008_pg_trgm_search_indexes
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = '009_contacts'
down_revision = '008_pg_trgm_search_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'contacts',
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('contact_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    with op.batch_alter_table('chats') as batch:
        batch.add_column(sa.Column('is_dm', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('chats') as batch:
        batch.drop_column('is_dm')

    op.drop_table('contacts')
