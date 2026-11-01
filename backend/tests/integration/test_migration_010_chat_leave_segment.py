"""010_chat_leave segment roundtrip on a scratch SQLite file.

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps its
operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 010 segment the feature owns, in both
directions:

    create_all(current models) -> stamp head -> downgrade -1 ->
    upgrade head

`downgrade '009_contacts'` runs 010's own downgrade against the stamped
state and yields the faithful 009 one (chat_members without left_at);
`upgrade head` re-applies 010 to that state. The step targets the
EXPLICIT 009 revision: it was head-relative ('-1') while 010_chat_leave
was the head, and the first newer head (011_settings) repointed it —
a later head must never shift the step again (the note inside
test_migration_009_contacts_segment.py explains the trap). The schema is
asserted by an inspector after each step. Alembic runs through the real
env wiring: env.py reads Settings() on every command, so the
CHATTY_DATABASE_URL override routes every command to the scratch file
(app/core/config.py env_prefix).
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.base import Base
from app.models import ChatMember  # noqa: F401 - register model metadata (env.py rule)

# backend/ (alembic.ini + alembic/) lives two levels up from this test file
BACKEND_DIR = Path(__file__).resolve().parents[2]


def snapshot_schema(database_url: str) -> tuple[set[str], set[str]]:
    """(table names, chat_members column names) through a short-lived
    connection — nothing stays open between the alembic commands."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            columns = {column['name'] for column in inspector.get_columns('chat_members')}
    finally:
        engine.dispose()
    return tables, columns


def test_010_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    tables, member_columns = snapshot_schema(database_url)
    assert 'chat_members' in tables
    assert 'left_at' in member_columns

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 010's own downgrade yields the faithful 009 state: the row keeps
    # living without the archive marker (and the 009 segment stays put).
    # The target is the explicit revision, not '-1': 011_settings is the
    # head now, so the relative step would run 011's downgrade instead and
    # land on 010 — the repoint this test's own docstring prescribed for
    # the first newer head (the note in test_migration_009_contacts_segment.py
    # explains the trap).
    command.downgrade(config, '009_contacts')
    tables, member_columns = snapshot_schema(database_url)
    assert 'chat_members' in tables
    assert 'left_at' not in member_columns
    assert 'contacts' in tables

    # re-applies 010 to that state
    command.upgrade(config, 'head')
    tables, member_columns = snapshot_schema(database_url)
    assert 'chat_members' in tables
    assert 'left_at' in member_columns
    assert 'contacts' in tables
