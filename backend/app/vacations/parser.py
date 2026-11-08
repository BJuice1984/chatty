"""Parser for the corporate vacation schedule xlsx.

Port of the parsing logic proven against the real file by
tasks/RAG-docs/vacation_query.py (the MATCHING there was substring-based
and is deliberately NOT ported — see vacations/service.py for the
stricter token rule). The real workbook mixes real date cells with
string cells ('15/06/2026', '21.09.', '15.06'), department header rows
that carry only column A, and name-only rows without dates; truncated
string dates take their year from the file name (график отпусков
2026.xlsx), falling back to the current year.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

_YEAR_RE = re.compile(r'(20\d{2})')
_DATE_FORMATS = ('%d.%m.%Y', '%d/%m/%Y', '%d.%m.', '%d.%m', '%d/%m')


@dataclass(frozen=True)
class ParsedRow:
    full_name: str
    department: str | None
    position: str | None
    start: date
    days: int


@dataclass(frozen=True)
class ParsedSchedule:
    source_name: str
    year: int
    rows: tuple[ParsedRow, ...]
    skipped: tuple[str, ...]


def schedule_year_from_name(name: str) -> int:
    """Year for truncated dates: the 20\\d{2} in the file name, else today."""

    match = _YEAR_RE.search(name)
    if match:
        return int(match.group(1))
    return date.today().year


def parse_date_value(value: object, year: int) -> date | None:
    """Date from a workbook cell: datetime, '15/06/2026', '21.09.', '15.06'.

    Formats without a %Y component yield year 1900 from strptime — those
    are replaced with the schedule year. Rows without a parseable date
    never reach the storage (D-8: they land in the skip notes instead).
    """

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt).date()
        except ValueError:
            continue
        if parsed.year == 1900:
            parsed = parsed.replace(year=year)
        return parsed
    return None


def _cell_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_days(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _at(values: tuple, index: int) -> object:
    """read-only sheets yield short tuples for sparse rows."""

    return values[index] if index < len(values) else None


def parse_schedule(path: Path) -> ParsedSchedule:
    """Parse every sheet whose B1 is 'ФИО' into dated rows + skip notes."""

    year = schedule_year_from_name(path.name)
    workbook = load_workbook(path, read_only=True, data_only=True)
    rows: list[ParsedRow] = []
    skipped: list[str] = []
    try:
        for sheet in workbook.worksheets:
            department: str | None = None
            qualified = False
            for row_number, values in enumerate(
                sheet.iter_rows(min_row=1, max_col=5, values_only=True),
                start=1,
            ):
                position_text = _cell_text(_at(values, 0))
                name_text = _cell_text(_at(values, 1))
                if row_number == 1:
                    # only sheets with the canonical header qualify
                    qualified = name_text == 'ФИО'
                    continue
                if not qualified:
                    break
                if name_text is None:
                    if position_text is not None and all(
                        _cell_text(_at(values, index)) is None for index in range(1, 5)
                    ):
                        # department-only row scopes the rows below it
                        department = position_text
                    continue
                start = parse_date_value(_at(values, 2), year)
                days = _parse_days(_at(values, 3))
                if start is None or days is None:
                    # name-only or half-filled rows never reach storage
                    skipped.append(f'{sheet.title} r{row_number}: {name_text}')
                    continue
                rows.append(
                    ParsedRow(
                        full_name=name_text,
                        department=department,
                        position=position_text,
                        start=start,
                        days=days,
                    )
                )
    finally:
        workbook.close()
    return ParsedSchedule(
        source_name=path.name,
        year=year,
        rows=tuple(rows),
        skipped=tuple(skipped),
    )
