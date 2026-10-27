"""pg_trgm functional GIN indexes for the /chats/search LIKE scan.

search_title_matches / search_message_matches in repositories/chats.py
filter exactly lower(chats.title) and lower(messages.content) with
LIKE '%q%' (escape '\\') — PostgreSQL serves that from an index only when
the index is built over the same expression, hence functional indexes:
a plain gin_trgm_ops index over the raw column would not match the
filtered expression. The query<->index coupling is deliberate — a future
rewrite of those queries that changes the filtered expression must
migrate these indexes in lockstep (a code comment in repositories/chats.py
is deferred to a later code-touching task).

PG-only, the accepted 005 precedent: pytest fixtures build the schema
with Base.metadata.create_all and never run alembic; verify:backend
checks pytest + `alembic heads` only. CREATE EXTENSION needs the DB
owner / CREATE privilege — the compose POSTGRES_USER owns the database;
on a hosted PG without it this migration fails (operator note).

Downgrade drops only the indexes: pg_trgm is a shared cluster object
(other databases may depend on it), so the extension is kept.

Insert-path tradeoff: every message send now maintains the messages GIN
trigram index (write amplification on the hottest write path);
fastupdate=on amortizes inserts through the pending list by default —
tuning (fastupdate/gin_pending_list_limit) is out of scope here.

Revision ID: 008_pg_trgm_search_indexes
Revises: 007_avatars_stories
Create Date: 2026-10-27
"""

from alembic import op
import sqlalchemy as sa


revision = '008_pg_trgm_search_indexes'
down_revision = '007_avatars_stories'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')

    op.create_index(
        'ix_chats_title_trgm',
        'chats',
        [sa.text('lower(title)')],
        unique=False,
        postgresql_using='gin',
        postgresql_ops={'lower(title)': 'gin_trgm_ops'},
    )
    op.create_index(
        'ix_messages_content_trgm',
        'messages',
        [sa.text('lower(content)')],
        unique=False,
        postgresql_using='gin',
        postgresql_ops={'lower(content)': 'gin_trgm_ops'},
    )


def downgrade() -> None:
    op.drop_index('ix_messages_content_trgm', table_name='messages')
    op.drop_index('ix_chats_title_trgm', table_name='chats')
