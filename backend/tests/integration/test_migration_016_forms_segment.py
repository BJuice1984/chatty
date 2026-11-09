"""016_vacation_forms segment roundtrip on a scratch SQLite file.

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps
its operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 016 segment the feature owns, in both
directions (the 011/015 template):

    create_all(current models) -> stamp head -> downgrade '015_vacations'
    -> upgrade head

The downgrade target is the EXPLICIT 015_vacations revision — the
segment's own down_revision — never the head-relative '-1' (the trap
documented inside test_migration_011_settings_segment.py).
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


def state_columns(database_url: str) -> set[str]:
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            return {column['name'] for column in inspector.get_columns('assistant_dialog_state')}
    finally:
        engine.dispose()


def test_016_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    assert 'payload' in state_columns(database_url)

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 016's own downgrade yields the faithful 015 state: the payload
    # column is gone while the dialog-state table and the rest stay put
    command.downgrade(config, '015_vacations')
    columns = state_columns(database_url)
    assert 'payload' not in columns
    assert {'user_id', 'state', 'origin_content', 'attempts', 'updated_at'} <= columns

    # re-applies 016 to that state
    command.upgrade(config, 'head')
    assert 'payload' in state_columns(database_url)
