"""Auto-title marker column: chats.auto_titled.

auto_titled (Boolean, NOT NULL, server_default '0') marks chats whose title
the server generates: the one-click creation flow seeds 'Чат с' and every
fresh member addition appends their name; a manual rename clears the flag
permanently (the future LLM context-naming step renames only auto-titled
chats). Additive: existing rows read as manual titles ('0'), no backfill.

batch_alter_table keeps the column add/drop runnable on SQLite while
staying a no-op wrapper on PostgreSQL (the 007/009/010/011/012 precedent).
A full-chain SQLite run stays impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PG-only — so both directions of THIS segment are proven inside
pytest (tests/integration/test_migration_013_chat_auto_title_segment.py);
the full chain keeps its operational proof on the compose PostgreSQL
(docs/deployment/own-backend.md).

Revision ID: 013_chat_auto_title
Revises: 012_message_kind
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa

revision = '013_chat_auto_title'
down_revision = '012_message_kind'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('chats') as batch:
        batch.add_column(sa.Column('auto_titled', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('chats') as batch:
        batch.drop_column('auto_titled')
