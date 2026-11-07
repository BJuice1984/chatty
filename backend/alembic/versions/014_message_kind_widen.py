"""Widen messages.kind from VARCHAR(16) to VARCHAR(32).

The membership feed lines (0a64213) write longer kind literals than 012
planned for its single 'chat_renamed' value: 'chat_member_added' (17),
'chat_member_left' (17), 'chat_member_removed' (19),
'chat_member_rejoined' (20). PostgreSQL rejects those INSERTs with
StringDataRightTruncation (a live 500 on POST/DELETE /chats/{id}/members),
while the pytest gate never sees it — the gate runs on SQLite, which does
not enforce varchar lengths. The widen is metadata-only on PostgreSQL and
needs no backfill: existing rows keep their short kinds.

The downgrade narrows back to 16 and will fail on any row already holding
a longer kind — the operator narrows deliberately, after a manual cleanup.

batch_alter_table keeps the alter runnable on SQLite while staying a
no-op wrapper on PostgreSQL (the 007..013 precedent). A full-chain SQLite
run stays impossible by design — 008 executes CREATE EXTENSION pg_trgm
and 005 uses an ALTER-based create_foreign_key, both PG-only — so both
directions of THIS segment are proven inside pytest
(tests/integration/test_migration_014_message_kind_widen_segment.py);
the full chain keeps its operational proof on the compose PostgreSQL
(docs/deployment/own-backend.md).

Revision ID: 014_message_kind_widen
Revises: 013_chat_auto_title
Create Date: 2026-11-07
"""

from alembic import op
import sqlalchemy as sa

revision = '014_message_kind_widen'
down_revision = '013_chat_auto_title'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('messages') as batch:
        batch.alter_column(
            'kind',
            existing_type=sa.String(length=16),
            type_=sa.String(length=32),
            existing_nullable=True,
        )


def downgrade() -> None:
    with op.batch_alter_table('messages') as batch:
        batch.alter_column(
            'kind',
            existing_type=sa.String(length=32),
            type_=sa.String(length=16),
            existing_nullable=True,
        )
