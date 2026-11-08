"""ingest_vacations.py main()-level pins: idempotent replace, new year, --db."""

from __future__ import annotations

import sys
from pathlib import Path

from openpyxl import Workbook
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.models import VacationPeriod, VacationSchedule

BACKEND_DIR = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND_DIR / 'scripts'))

from ingest_vacations import main  # noqa: E402


def build_xlsx(path: Path, *, department: str = 'Департамент Альфа') -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = department
    sheet.append(['Должность', 'ФИО', 'Дата начала отпуска', 'Количество календарных дней', 'Заместитель'])
    sheet.append([department])
    sheet.append(['Инженер-программист', 'Абрикосов Т.П.', '20.04.2026', 7, 'Огурцов С.С.'])
    sheet.append(['Инженер-программист', 'Абрикосов Т.П.', '03.08.2026', 14, 'Огурцов С.С.'])
    sheet.append(['Инженер-программист', 'Абрикосов Т.П.', '21.12.2026', 7, 'Огурцов С.С.'])
    sheet.append(['Инженер-программист', 'Клубников Э.Э.', None, None, None])
    workbook.save(path)


def counts(database_url: str):
    engine = create_engine(database_url)
    try:
        with Session(engine) as session:
            schedules = list(
                session.scalars(select(VacationSchedule).order_by(VacationSchedule.year))
            )
            periods = session.scalar(select(func.count(VacationPeriod.id)))
        return schedules, periods
    finally:
        engine.dispose()


def test_ingest_replaces_same_year_and_adds_new_year(tmp_path: Path):
    database_url = f"sqlite:///{(tmp_path / 'scratch.db').as_posix()}"
    from app.db.base import Base

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    engine.dispose()

    schedule_2026 = tmp_path / 'график отпусков 2026.xlsx'
    build_xlsx(schedule_2026)

    assert main(['--file', str(schedule_2026), '--db', database_url]) == 0
    schedules, periods = counts(database_url)
    assert len(schedules) == 1
    assert schedules[0].year == 2026
    assert schedules[0].source_name == 'график отпусков 2026.xlsx'
    assert schedules[0].row_count == 3
    assert periods == 3

    # re-run of the same year: wholesale replace, no duplicates
    assert main(['--file', str(schedule_2026), '--db', database_url]) == 0
    schedules, periods = counts(database_url)
    assert len(schedules) == 1
    assert periods == 3

    # a new-year file lands alongside
    schedule_2027 = tmp_path / 'график отпусков 2027.xlsx'
    build_xlsx(schedule_2027, department='Департамент Бета')
    assert main(['--file', str(schedule_2027), '--db', database_url]) == 0
    schedules, periods = counts(database_url)
    assert [schedule.year for schedule in schedules] == [2026, 2027]
    assert periods == 6


def test_ingest_missing_file_fails_cleanly(tmp_path: Path):
    database_url = f"sqlite:///{(tmp_path / 'scratch.db').as_posix()}"
    assert main(['--file', str(tmp_path / 'нет.xlsx'), '--db', database_url]) == 1
