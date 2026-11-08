"""Parser pins over a synthetic xlsx reproducing the real dirty formats."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from openpyxl import Workbook

from app.vacations.parser import parse_schedule, schedule_year_from_name


def build_schedule_xlsx(path: Path) -> None:
    """Every dirty format of the real workbook, plus the clean ones."""

    workbook = Workbook()
    first = workbook.active
    first.title = 'Департамент Альфа'
    first.append(['Должность', 'ФИО', 'Дата начала отпуска', 'Количество календарных дней', 'Заместитель'])
    first.append(['Департамент Альфа'])  # department-only row (column A only)
    first.append(['Ведущий инженер', 'Абрикосов Т.П.', '15/06/2026', 14, None])
    first.append(['Инженер-программист', 'Вишневский О.Н.', datetime(2026, 4, 29), 14, None])
    first.append(['Инженер-программист', 'Клубников Э.Э.', '18.06.2026', 1, None])
    first.append(['Инженер тех. поддержки', 'Малинин Р.Р.', None, None, None])  # name-only -> skipped
    first.append(['Инженер-программист', 'Огурцов С.С.', '15.06', 14, None])  # truncated, no dot
    first.append(['Системный аналитик', 'Свеклов Н.Н.', '21.09.', 14, 'Тыквин А.А.'])  # trailing dot
    first.append([None, 'Персиков В.В.', ' ', ' ', None])  # whitespace cells -> skipped

    second = workbook.create_sheet('Департамент Бета')
    second.append(['Должность', 'ФИО', 'Дата начала отпуска', 'Количество календарных дней', 'Заместитель'])
    second.append(['Департамент Бета'])
    second.append(['Менеджер', 'Лимонов Г.Ш.', '23.03.2026', 14, 'нет'])
    second.append(['Ассистент', 'Морошкин Ю.Ю.', '01/09/2026', 14, 'нет'])

    unqualified = workbook.create_sheet('Служебный')
    unqualified.append(['прочее', 'не ФИО'])
    unqualified.append(['x', 'y'])

    workbook.save(path)


def test_parser_dirty_formats_and_departments(tmp_path: Path) -> None:
    path = tmp_path / 'график отпусков 2026.xlsx'
    build_schedule_xlsx(path)
    parsed = parse_schedule(path)

    assert parsed.year == 2026
    assert parsed.source_name == 'график отпусков 2026.xlsx'
    by_name = {row.full_name: row for row in parsed.rows}
    assert set(by_name) == {
        'Абрикосов Т.П.',
        'Вишневский О.Н.',
        'Клубников Э.Э.',
        'Огурцов С.С.',
        'Свеклов Н.Н.',
        'Лимонов Г.Ш.',
        'Морошкин Ю.Ю.',
    }

    abrikosov = by_name['Абрикосов Т.П.']
    assert (abrikosov.start.year, abrikosov.start.month, abrikosov.start.day) == (2026, 6, 15)
    assert abrikosov.days == 14
    assert abrikosov.department == 'Департамент Альфа'
    assert abrikosov.position == 'Ведущий инженер'

    vishnevsky = by_name['Вишневский О.Н.']
    assert (vishnevsky.start.month, vishnevsky.start.day) == (4, 29)

    ogurtsov = by_name['Огурцов С.С.']
    assert (ogurtsov.start.year, ogurtsov.start.month, ogurtsov.start.day) == (2026, 6, 15)

    sveklov = by_name['Свеклов Н.Н.']
    assert (sveklov.start.year, sveklov.start.month) == (2026, 9)

    lemonov = by_name['Лимонов Г.Ш.']
    assert lemonov.department == 'Департамент Бета'
    assert (lemonov.start.day, lemonov.start.month) == (23, 3)

    moroshkin = by_name['Морошкин Ю.Ю.']
    assert (moroshkin.start.month, moroshkin.start.day) == (9, 1)

    # name-only and whitespace rows land in the skip notes, never in rows
    assert len(parsed.skipped) == 2
    assert any('Малинин Р.Р.' in note for note in parsed.skipped)
    assert any('Персиков В.В.' in note for note in parsed.skipped)


def test_parser_takes_truncated_year_from_file_name(tmp_path: Path) -> None:
    path = tmp_path / 'график отпусков 2027.xlsx'
    build_schedule_xlsx(path)
    parsed = parse_schedule(path)

    assert parsed.year == 2027
    by_name = {row.full_name: row for row in parsed.rows}
    assert by_name['Огурцов С.С.'].start.year == 2027
    assert by_name['Свеклов Н.Н.'].start.year == 2027
    # explicit four-digit dates keep their own year
    assert by_name['Вишневский О.Н.'].start.year == 2026
    assert by_name['Лимонов Г.Ш.'].start.year == 2026


def test_schedule_year_fallback_is_current_year() -> None:
    from datetime import date

    assert schedule_year_from_name('какой-то файл.xlsx') == date.today().year
