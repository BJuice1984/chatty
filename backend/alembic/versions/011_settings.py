"""User profile columns: display_name, phone, send_read_receipts.

display_name (String(120), NULLable) is the editable display name shown
everywhere the user's name appears — NULL falls back to the email local
part at the response boundaries (UserSearchItem, ContactResponse,
to_member_brief); phone (String(30), NULLable) is the editable contact
phone; send_read_receipts (Boolean NOT NULL, server_default '1') gates
the viewer's own history loads from advancing their last-read marker
(chat_last_reads feeds only the viewer's own unread badge —
sender-visible receipts are a non-goal). Existing rows are receipts-on
by the server default; no backfill is needed.

batch_alter_table keeps the column adds runnable on SQLite while staying
a no-op wrapper on PostgreSQL (the 007/009/010 precedent). A full-chain
SQLite run stays impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PG-only — so both directions of THIS segment are proven inside
pytest (tests/integration/test_migration_011_settings_segment.py); the
full chain keeps its operational proof on the compose PostgreSQL
(docs/deployment/own-backend.md).

Revision ID: 011_settings
Revises: 010_chat_leave
Create Date: 2026-11-01
"""

from alembic import op
import sqlalchemy as sa

revision = '011_settings'
down_revision = '010_chat_leave'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('display_name', sa.String(length=120), nullable=True))
        batch.add_column(sa.Column('phone', sa.String(length=30), nullable=True))
        batch.add_column(sa.Column('send_read_receipts', sa.Boolean(), server_default='1', nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('send_read_receipts')
        batch.drop_column('phone')
        batch.drop_column('display_name')
