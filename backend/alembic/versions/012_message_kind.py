"""System-message marker column: messages.kind.

kind (String(16), NULLable) marks service feed entries — NULL keeps the
ordinary-message meaning, today's single value is 'chat_renamed' (the
persistent "who renamed the chat and when" line written by PUT
/chats/{id}). Additive: existing rows stay ordinary by the NULL default,
no backfill is needed.

batch_alter_table keeps the column add/drop runnable on SQLite while
staying a no-op wrapper on PostgreSQL (the 007/009/010/011 precedent).
A full-chain SQLite run stays impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PG-only — so both directions of THIS segment are proven inside
pytest (tests/integration/test_migration_012_message_kind_segment.py);
the full chain keeps its operational proof on the compose PostgreSQL
(docs/deployment/own-backend.md).

Revision ID: 012_message_kind
Revises: 011_settings
Create Date: 2026-11-05
"""

from alembic import op
import sqlalchemy as sa

revision = '012_message_kind'
down_revision = '011_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('messages') as batch:
        batch.add_column(sa.Column('kind', sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('messages') as batch:
        batch.drop_column('kind')
