"""011_settings segment roundtrip on a scratch SQLite file.

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps its
operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 011 segment the feature owns, in both
directions:

    create_all(current models) -> stamp head -> downgrade '010_chat_leave' ->
    upgrade head

The downgrade step targets the EXPLICIT 010_chat_leave revision, not the
head-relative '-1': 011_settings is the head today, so both spellings
agree now, but the moment a newer migration lands the relative step would
start landing on 011 instead of 010 — the trap documented inside
test_migration_009_contacts_segment.py. `downgrade '010_chat_leave'` runs
011's own downgrade against the stamped state and yields the faithful 010
one (users without the three profile columns, chat_members still carrying
left_at); `upgrade head` re-applies 011 to that state. The schema is
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
from app.models import User  # noqa: F401 - register model metadata (env.py rule)

# backend/ (alembic.ini + alembic/) lives two levels up from this test file
BACKEND_DIR = Path(__file__).resolve().parents[2]


def snapshot_schema(database_url: str) -> tuple[set[str], set[str], set[str]]:
    """(table names, users column names, chat_members column names) through
    a short-lived connection — nothing stays open between the alembic
    commands; chat_members proves the downgrade did not overshoot 010."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            user_columns = {column['name'] for column in inspector.get_columns('users')}
            member_columns = {column['name'] for column in inspector.get_columns('chat_members')}
    finally:
        engine.dispose()
    return tables, user_columns, member_columns


def test_011_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    tables, user_columns, member_columns = snapshot_schema(database_url)
    assert 'users' in tables
    assert {'display_name', 'phone', 'send_read_receipts'} <= user_columns

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 011's own downgrade yields the faithful 010 state: the users row keeps
    # living without the profile columns, the 010 segment stays put (the
    # explicit target, not '-1', keeps a future head from shifting it)
    command.downgrade(config, '010_chat_leave')
    tables, user_columns, member_columns = snapshot_schema(database_url)
    assert 'users' in tables
    assert 'display_name' not in user_columns
    assert 'phone' not in user_columns
    assert 'send_read_receipts' not in user_columns
    assert 'chat_members' in tables
    assert 'left_at' in member_columns

    # re-applies 011 to that state
    command.upgrade(config, 'head')
    tables, user_columns, member_columns = snapshot_schema(database_url)
    assert 'users' in tables
    assert {'display_name', 'phone', 'send_read_receipts'} <= user_columns
    assert 'chat_members' in tables
    assert 'left_at' in member_columns
