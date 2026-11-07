"""014_message_kind_widen segment roundtrip on a scratch SQLite file.

A full-chain SQLite run is impossible by design — 008 executes
CREATE EXTENSION pg_trgm and 005 uses an ALTER-based create_foreign_key,
both PostgreSQL-only by their own docstrings — so the full chain keeps its
operational proof on the compose PostgreSQL (docs/deployment/own-backend.md)
and this test proves exactly the 014 segment the feature owns, in both
directions:

    create_all(current models) -> stamp head -> downgrade '013_chat_auto_title' ->
    upgrade head

The downgrade step targets the EXPLICIT 013_chat_auto_title revision (the
009/010 trap lesson: a head-relative '-1' would shift onto a newer head the
moment one lands). `downgrade '013_chat_auto_title'` runs 014's own downgrade
against the stamped state and yields the faithful 013 one; `upgrade head`
re-applies 014 to it. The kind column WIDTH is asserted after each step —
16 before the widen, 32 after — because that width is the whole point of
014: the membership feed kinds (up to 'chat_member_rejoined', 20 chars)
hit StringDataRightTruncation on the production PostgreSQL while the
SQLite gate stays green (SQLite ignores varchar lengths).
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.db.base import Base
from app.models import User  # noqa: F401 - register model metadata (env.py rule)
from app.models.chat import Chat  # noqa: F401 - the 013 boundary marker column
from app.models.message import Message  # noqa: F401 - the segment's own table

# backend/ (alembic.ini + alembic/) lives two levels up from this test file
BACKEND_DIR = Path(__file__).resolve().parents[2]


def kind_width(database_url: str) -> tuple[bool, int, bool]:
    """(kind column exists, its varchar length, auto_titled column exists)
    through a short-lived connection — nothing stays open between the
    alembic commands; auto_titled proves the downgrade stopped AT 013
    and did not overshoot."""
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            inspector = inspect(connection)
            message_columns = {column['name']: column for column in inspector.get_columns('messages')}
            chat_columns = {column['name'] for column in inspector.get_columns('chats')}
    finally:
        engine.dispose()
    kind = message_columns.get('kind')
    return kind is not None, int(kind['type'].length or 0), 'auto_titled' in chat_columns


def test_014_segment_downgrade_upgrade_roundtrip(tmp_path, monkeypatch):
    scratch = tmp_path / 'scratch.db'
    database_url = f'sqlite:///{scratch.as_posix()}'
    monkeypatch.setenv('CHATTY_DATABASE_URL', database_url)
    # script_location in alembic.ini is cwd-relative and Settings reads
    # .env from the cwd — run the commands from backend/ like verify.sh does
    monkeypatch.chdir(BACKEND_DIR)

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    # the current models already carry the widened column
    has_kind, width, has_auto_titled = kind_width(database_url)
    assert has_kind and width == 32 and has_auto_titled

    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    command.stamp(config, 'head')

    # 014's own downgrade yields the faithful 013 state: the kind column
    # survives at its pre-widen width, the 013 segment stays put (the
    # explicit target keeps a future head from shifting it)
    command.downgrade(config, '013_chat_auto_title')
    has_kind, width, has_auto_titled = kind_width(database_url)
    assert has_kind and width == 16 and has_auto_titled

    # re-applies 014 to that state
    command.upgrade(config, 'head')
    has_kind, width, has_auto_titled = kind_width(database_url)
    assert has_kind and width == 32 and has_auto_titled
