"""012_message_kind segment roundtrip on a scratch SQLite file.

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps its
operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 012 segment the feature owns, in both
directions:

    create_all(current models) -> stamp head -> downgrade '011_settings' ->
    upgrade head

The downgrade step targets the EXPLICIT 011_settings revision (the 009/010
trap lesson: a head-relative '-1' would shift onto a newer head the moment
one lands). `downgrade '011_settings'` runs 012's own downgrade against the
stamped state and yields the faithful 011 one; `upgrade head` re-applies
012 to it. The schema is asserted by an inspector after each step. Alembic
runs through the real env wiring: env.py reads Settings() on every command,
so the CHATTY_DATABASE_URL override routes every command to the scratch
file (app/core/config.py env_prefix).
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.base import Base
from app.models import User  # noqa: F401 - register model metadata (env.py rule)
from app.models.message import Message  # noqa: F401 - the segment's own table

# backend/ (alembic.ini + alembic/) lives two levels up from this test file
BACKEND_DIR = Path(__file__).resolve().parents[2]


def snapshot_schema(database_url: str) -> tuple[set[str], set[str], set[str]]:
    """(table names, messages column names, users column names) through a
    short-lived connection — nothing stays open between the alembic
    commands; users proves the downgrade did not overshoot 011."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            message_columns = {column['name'] for column in inspector.get_columns('messages')}
            user_columns = {column['name'] for column in inspector.get_columns('users')}
    finally:
        engine.dispose()
    return tables, message_columns, user_columns


def test_012_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    tables, message_columns, user_columns = snapshot_schema(database_url)
    assert 'messages' in tables
    assert 'kind' in message_columns

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 012's own downgrade yields the faithful 011 state: messages live on
    # without the kind marker, the 011 segment stays put (the explicit
    # target keeps a future head from shifting it)
    command.downgrade(config, '011_settings')
    tables, message_columns, user_columns = snapshot_schema(database_url)
    assert 'messages' in tables
    assert 'kind' not in message_columns
    assert 'users' in tables
    assert {'display_name', 'phone', 'send_read_receipts'} <= user_columns

    # re-applies 012 to that state
    command.upgrade(config, 'head')
    tables, message_columns, user_columns = snapshot_schema(database_url)
    assert 'messages' in tables
    assert 'kind' in message_columns
    assert {'display_name', 'phone', 'send_read_receipts'} <= user_columns
