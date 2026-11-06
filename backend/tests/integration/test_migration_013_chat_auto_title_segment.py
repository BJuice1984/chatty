"""013_chat_auto_title segment roundtrip on a scratch SQLite file.

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps
its operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 013 segment the feature owns, in both
directions:

    create_all(current models) -> stamp head -> downgrade '012_message_kind' ->
    upgrade head

The downgrade step targets the EXPLICIT 012_message_kind revision (the
009/010 trap lesson: a head-relative '-1' would shift onto a newer head
the moment one lands). `downgrade '012_message_kind'` runs 013's own
downgrade against the stamped state and yields the faithful 012 one;
`upgrade head` re-applies 013 to it. The schema is asserted by an
inspector after each step. Alembic runs through the real env wiring:
env.py reads Settings() on every command, so the CHATTY_DATABASE_URL
override routes every command to the scratch file (app/core/config.py
env_prefix).
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.base import Base
from app.models import User  # noqa: F401 - register model metadata (env.py rule)
from app.models.chat import Chat  # noqa: F401 - the segment's own table
from app.models.message import Message  # noqa: F401 - the 012 boundary proof

# backend/ (alembic.ini + alembic/) lives two levels up from this test file
BACKEND_DIR = Path(__file__).resolve().parents[2]


def snapshot_schema(database_url: str) -> tuple[set[str], set[str], set[str]]:
    """(table names, chats column names, messages column names) through a
    short-lived connection — nothing stays open between the alembic
    commands; messages proves the downgrade did not overshoot 012."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            chat_columns = {column['name'] for column in inspector.get_columns('chats')}
            message_columns = {column['name'] for column in inspector.get_columns('messages')}
    finally:
        engine.dispose()
    return tables, chat_columns, message_columns


def test_013_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    tables, chat_columns, message_columns = snapshot_schema(database_url)
    assert 'chats' in tables
    assert 'auto_titled' in chat_columns

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 013's own downgrade yields the faithful 012 state: chats live on
    # without the auto-title marker, the 012 segment stays put (the
    # explicit target keeps a future head from shifting it)
    command.downgrade(config, '012_message_kind')
    tables, chat_columns, message_columns = snapshot_schema(database_url)
    assert 'chats' in tables
    assert 'auto_titled' not in chat_columns
    assert 'messages' in tables
    assert 'kind' in message_columns  # the 012 boundary, not overshot

    # re-applies 013 to that state
    command.upgrade(config, 'head')
    tables, chat_columns, message_columns = snapshot_schema(database_url)
    assert 'chats' in tables
    assert 'auto_titled' in chat_columns
    assert 'kind' in message_columns
