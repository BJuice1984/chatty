"""Ingest the vacation schedule xlsx into the database (D-13).

Usage (from the repository root, with the backend venv interpreter):

    python backend/scripts/ingest_vacations.py [--file PATH] [--db URL]

--file defaults to the newest match of CHATTY_VACATION_DATA_DIR /
CHATTY_VACATION_FILE_GLOB (app/vacations/config.py; the default data
dir is backend/data). --db overrides CHATTY_DATABASE_URL for host runs
against the compose PostgreSQL (operator env credentials). Re-running
with the same year+source REPLACES the snapshot wholesale; a new-year
file is added alongside. Stored user surnames live in their own table
and are never touched. Exit codes: 0 ok, 1 file missing/unparsable.

The operator runbook lives at docs/deployment/vacation-schedule.md.
"""

from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import create_engine, delete, select  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.models import VacationPeriod, VacationSchedule  # noqa: E402
from app.vacations.config import vacation_settings_from_env  # noqa: E402
from app.vacations.parser import parse_schedule  # noqa: E402


def _default_file() -> Path | None:
    settings = vacation_settings_from_env()
    candidates = sorted(settings.data_dir.glob(settings.file_glob))
    return candidates[-1] if candidates else None


def _database_url(override: str | None) -> str:
    if override:
        return override
    from app.core.config import get_settings

    return get_settings().database_url


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Ingest the vacation schedule xlsx')
    parser.add_argument('--file', type=Path, default=None, help='xlsx path (default: newest glob match in the data dir)')
    parser.add_argument('--db', type=str, default=None, help='database URL override (default: CHATTY_DATABASE_URL)')
    args = parser.parse_args(argv)

    path = args.file or _default_file()
    if path is None or not path.is_file():
        hint = str(path) if path else 'нет совпадений с glob в data-dir'
        print(f'Файл графика не найден: {hint}', file=sys.stderr)
        return 1

    parsed = parse_schedule(path)
    if not parsed.rows:
        print(f'В файле нет датированных строк: {path}', file=sys.stderr)
        return 1

    engine = create_engine(_database_url(args.db))
    try:
        with Session(engine) as session:
            with session.begin():
                stale_ids = session.scalars(
                    select(VacationSchedule.id).where(
                        VacationSchedule.year == parsed.year,
                        VacationSchedule.source_name == parsed.source_name,
                    )
                ).all()
                # periods first: SQLite runs without FK enforcement, so the
                # ON DELETE CASCADE never fires there — delete explicitly
                session.execute(
                    delete(VacationPeriod).where(VacationPeriod.schedule_id.in_(stale_ids))
                )
                session.execute(
                    delete(VacationSchedule).where(VacationSchedule.id.in_(stale_ids))
                )
                schedule = VacationSchedule(
                    source_name=parsed.source_name,
                    year=parsed.year,
                    row_count=len(parsed.rows),
                    ingested_at=datetime.now(UTC),
                )
                session.add(schedule)
                session.flush()
                session.add_all(
                    VacationPeriod(
                        schedule_id=schedule.id,
                        full_name=row.full_name,
                        department=row.department,
                        position=row.position,
                        start_date=row.start,
                        days=row.days,
                    )
                    for row in parsed.rows
                )
            schedule_id = session.scalar(
                select(VacationSchedule.id).where(
                    VacationSchedule.year == parsed.year,
                    VacationSchedule.source_name == parsed.source_name,
                )
            )
        print(f'Ингест {path.name}: год {parsed.year}, строк {len(parsed.rows)}, без дат {len(parsed.skipped)}')
        for note in parsed.skipped:
            print(f'  пропущено: {note}')
        print(f'Снимок закреплён (schedule id {schedule_id})')
        return 0
    finally:
        engine.dispose()


if __name__ == '__main__':
    raise SystemExit(main())
