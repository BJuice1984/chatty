"""Every kind literal written by the services must fit messages.kind.

The 014 lesson: 'chat_member_added' and friends (17..20 chars) exceeded the
VARCHAR(16) column planned for the single 'chat_renamed' value, and NOTHING
in the gate caught it — the pytest gate runs on SQLite, which does not
enforce varchar lengths, so the truncation surfaced only as a live 500
(StringDataRightTruncation) on the compose PostgreSQL. This pin greps the
service sources for kind literals and checks each against the column width
declared on the model, so the next longer kind fails the gate instead of
production.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.models.message import Message

SERVICES_DIR = Path(__file__).resolve().parents[3] / 'app' / 'services'
KIND_LITERAL = re.compile(r"kind\s*=\s*'([a-z_]+)'")


def test_every_kind_literal_fits_the_kind_column():
    kind_column = Message.__table__.columns['kind']
    limit = int(kind_column.type.length or 0)
    assert limit >= 20  # 'chat_member_rejoined' — the widest live kind

    sources = sorted(SERVICES_DIR.glob('*.py'))
    assert len(sources) > 0
    kinds: set[str] = set()
    for source in sources:
        kinds.update(KIND_LITERAL.findall(source.read_text(encoding='utf-8')))

    assert 'chat_renamed' in kinds  # the grep itself stays wired
    for kind in sorted(kinds):
        assert len(kind) <= limit, f'kind={kind!r} exceeds messages.kind VARCHAR({limit})'
