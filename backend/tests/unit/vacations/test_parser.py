"""Parser pins over a synthetic xlsx reproducing the real dirty formats."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from openpyxl import Workbook

from app.vacations.parser import parse_schedule, schedule_year_from_name


def build_schedule_xlsx(path: Path, *, second_year_sheet: bool = False) -> None:
    """Every dirty format of the real workbook, plus the clean ones."""

    workbook = Workbook()
    first = workbook.active
    first.title = 'Отдел ИТ'
    first.append(['Должность', 'ФИО', 'Дата начала отпуска', 'Количество календарных дней', 'Заместитель'])
    first.append(['Отдел ИТ'])  # department-only row (column A only)
    first.append(['Руководитель отдела ИТ', 'Лакизо А.В.', '15/06/2026', 14, None])
    first.append(['Инженер-программист', 'Гончаров М.О.', datetime(2026, 4, 29), 14, None])
    first.append(['Инженер-программист', 'Гильванов И.П.', '18.06.2026', 1, None])
    first.append(['Инженер тех. поддержки', 'Макаров М.Э.', None, None, None])  # name-only -> skipped
    first.append(['Инженер-программист', 'Веревкин Р.Ю.', '15.06', 14, None])  # truncated, no dot
    first.append(['Системный аналитик', 'Стародубцев И.С.', '21.09.', 14, 'Мацук В.В.'])  # trailing dot
    first.append([None, 'Ерошин И.П.', ' ', ' ', None])  # whitespace cells -> skipped

    second = workbook.create_sheet('Отдел продаж')
    second.append(['Должность', 'ФИО', 'Дата начала отпуска', 'Количество календарных дней', 'Заместитель'])
    second.append(['Отдел продаж'])
    second.append(['Менеджер отдела продаж', 'Луговской К.С.', '23.03.2026', 14, 'нет'])
    second.append(['Ассистент отдела продаж', 'Арсеньева И.Г.', '01/09/2026', 14, 'нет'])

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
        'Лакизо А.В.',
        'Гончаров М.О.',
        'Гильванов И.П.',
        'Веревкин Р.Ю.',
        'Стародубцев И.С.',
        'Луговской К.С.',
        'Арсеньева И.Г.',
    }

    lakizo = by_name['Лакизо А.В.']
    assert (lakizo.start.year, lakizo.start.month, lakizo.start.day) == (2026, 6, 15)
    assert lakizo.days == 14
    assert lakizo.department == 'Отдел ИТ'
    assert lakizo.position == 'Руководитель отдела ИТ'

    goncharov = by_name['Гончаров М.О.']
    assert (goncharov.start.month, goncharov.start.day) == (4, 29)

    verevkin = by_name['Веревкин Р.Ю.']
    assert (verevkin.start.year, verevkin.start.month, verevkin.start.day) == (2026, 6, 15)

    starodubtsev = by_name['Стародубцев И.С.']
    assert (starodubtsev.start.year, starodubtsev.start.month) == (2026, 9)

    lugovskoy = by_name['Луговской К.С.']
    assert lugovskoy.department == 'Отдел продаж'
    assert (lugovskoy.start.day, lugovskoy.start.month) == (23, 3)

    arseneva = by_name['Арсеньева И.Г.']
    assert (arseneva.start.month, arseneva.start.day) == (9, 1)

    # name-only and whitespace rows land in the skip notes, never in rows
    assert len(parsed.skipped) == 2
    assert any('Макаров М.Э.' in note for note in parsed.skipped)
    assert any('Ерошин И.П.' in note for note in parsed.skipped)


def test_parser_takes_truncated_year_from_file_name(tmp_path: Path) -> None:
    path = tmp_path / 'график отпусков 2027.xlsx'
    build_schedule_xlsx(path)
    parsed = parse_schedule(path)

    assert parsed.year == 2027
    by_name = {row.full_name: row for row in parsed.rows}
    assert by_name['Веревкин Р.Ю.'].start.year == 2027
    assert by_name['Стародубцев И.С.'].start.year == 2027
    # explicit four-digit dates keep their own year
    assert by_name['Гончаров М.О.'].start.year == 2026
    assert by_name['Луговской К.С.'].start.year == 2026


def test_schedule_year_fallback_is_current_year() -> None:
    from datetime import date

    assert schedule_year_from_name('какой-то файл.xlsx') == date.today().year
