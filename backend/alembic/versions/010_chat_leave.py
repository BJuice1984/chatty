"""Archived chat membership via chat_members.left_at.

left_at is NULL for an active member and carries the self-leave moment for
an archived one: the row (and with it the readable history and the list
entry) stays, writes and live pushes stop. A kick hard-deletes the row
instead, so no backfill is needed — existing rows are active by design and
the column ships nullable with no server default.

batch_alter_table keeps the column change runnable on SQLite while staying
a no-op wrapper on PostgreSQL (the 007/009 precedent). A full-chain SQLite
run stays impossible by design — 008 executes CREATE EXTENSION pg_trgm and
005 uses an ALTER-based create_foreign_key, both PG-only — so both
directions of THIS segment are proven inside pytest
(tests/integration/test_migration_010_chat_leave_segment.py); the full
chain keeps its operational proof on the compose PostgreSQL
(docs/deployment/own-backend.md).

Revision ID: 010_chat_leave
Revises: 009_contacts
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = '010_chat_leave'
down_revision = '009_contacts'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('chat_members') as batch:
        batch.add_column(sa.Column('left_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('chat_members') as batch:
        batch.drop_column('left_at')
