"""009_contacts segment roundtrip on a scratch SQLite file (review F-8).

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps its
operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 009 segment the feature owns, in both
directions:

    create_all(current models) -> stamp head -> downgrade -1 ->
    upgrade head

`downgrade -1` runs 009's own downgrade against the stamped state and
yields the faithful 008 one (no contacts table, chats without is_dm);
`upgrade head` re-applies 009 to that state. The schema is asserted by an
inspector after each step. Alembic runs through the real env wiring: env.py
reads Settings() on every command, so the CHATTY_DATABASE_URL override
routes every command to the scratch file (app/core/config.py env_prefix).
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.base import Base
from app.models import Contact  # noqa: F401 - register model metadata (env.py rule)

# backend/ (alembic.ini + alembic/) lives two levels up from this test file
BACKEND_DIR = Path(__file__).resolve().parents[2]


def snapshot_schema(database_url: str) -> tuple[set[str], set[str]]:
    """(table names, chats column names) through a short-lived connection —
    nothing stays open between the alembic commands."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            columns = {column['name'] for column in inspector.get_columns('chats')}
    finally:
        engine.dispose()
    return tables, columns


def test_009_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    tables, chats_columns = snapshot_schema(database_url)
    assert 'contacts' in tables
    assert 'is_dm' in chats_columns

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 009's own downgrade yields the faithful 008 state
    command.downgrade(config, '-1')
    tables, chats_columns = snapshot_schema(database_url)
    assert 'contacts' not in tables
    assert 'is_dm' not in chats_columns
    assert 'chats' in tables

    # re-applies 009 to that state
    command.upgrade(config, 'head')
    tables, chats_columns = snapshot_schema(database_url)
    assert 'contacts' in tables
    assert 'is_dm' in chats_columns
