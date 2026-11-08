"""015_vacations segment roundtrip on a scratch SQLite file.

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps
its operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 015 segment the feature owns, in both
directions (the 011 template):

    create_all(current models) -> stamp head -> downgrade '014_message_kind_widen'
    -> upgrade head

The downgrade target is the EXPLICIT 014_message_kind_widen revision —
the segment's own down_revision — never the head-relative '-1'
(the trap documented inside test_migration_011_settings_segment.py).
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.base import Base
from app.models import User  # noqa: F401 - register model metadata (env.py rule)

VACATION_TABLES = {
    'vacation_schedules',
    'vacation_periods',
    'vacation_names',
    'assistant_dialog_state',
}

# backend/ (alembic.ini + alembic/) lives two levels up from this test file
BACKEND_DIR = Path(__file__).resolve().parents[2]


def snapshot_schema(database_url: str):
    """(table names, vacation_periods columns/indexes/FKs, state FKs).

    Vacation specifics come back empty when the tables are absent (the
    post-downgrade snapshot must not query dropped tables).
    """

    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            if 'vacation_periods' not in tables or 'assistant_dialog_state' not in tables:
                return tables, set(), set(), set(), set()
            period_columns = {column['name'] for column in inspector.get_columns('vacation_periods')}
            period_indexes = {index['name'] for index in inspector.get_indexes('vacation_periods')}
            period_fks = {
                (fk['referred_table'], fk.get('options', {}).get('ondelete'))
                for fk in inspector.get_foreign_keys('vacation_periods')
            }
            state_fks = {
                (fk['referred_table'], fk.get('options', {}).get('ondelete'))
                for fk in inspector.get_foreign_keys('assistant_dialog_state')
            }
    finally:
        engine.dispose()
    return tables, period_columns, period_indexes, period_fks, state_fks


def test_015_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    tables, period_columns, period_indexes, period_fks, state_fks = snapshot_schema(database_url)
    assert VACATION_TABLES <= tables
    assert {'schedule_id', 'full_name', 'department', 'position', 'start_date', 'days'} <= period_columns
    assert 'ix_vacation_periods_schedule_full_name' in period_indexes
    assert ('vacation_schedules', 'CASCADE') in period_fks
    assert ('users', 'CASCADE') in state_fks

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 015's own downgrade yields the faithful 014 state: the four vacation
    # tables are gone while the pre-existing schema stays put
    command.downgrade(config, '014_message_kind_widen')
    tables, _, _, _, _ = snapshot_schema(database_url)
    assert not (VACATION_TABLES & tables)
    assert 'messages' in tables
    assert 'users' in tables

    # re-applies 015 to that state
    command.upgrade(config, 'head')
    tables, period_columns, period_indexes, period_fks, state_fks = snapshot_schema(database_url)
    assert VACATION_TABLES <= tables
    assert {'schedule_id', 'full_name', 'department', 'position', 'start_date', 'days'} <= period_columns
    assert 'ix_vacation_periods_schedule_full_name' in period_indexes
    assert ('vacation_schedules', 'CASCADE') in period_fks
    assert ('users', 'CASCADE') in state_fks
