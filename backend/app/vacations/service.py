"""Surname matching and period formatting over stored schedule rows.

The matching rule is NEW and deliberately stricter than the substring
containment of tasks/RAG-docs/vacation_query.py (which would have
matched «Свеклов» → «Свеклова Е.Е.»): first the FULL normalized name
must be equal (the bot itself asks for initials when surnames collide),
then the surname token must be equal, then prefix candidates are listed
for disambiguation, and difflib hints close misses (D-7, review r2).
Lookups run against the LATEST schedule snapshot: a re-ingest of the
same year replaces it wholesale and a new-year file becomes the fresh
answer source (D-13).
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import VacationPeriod, VacationSchedule

_SUGGESTION_COUNT = 3
_SUGGESTION_CUTOFF = 0.5


def normalize_name(value: str) -> str:
    """lower + ё→е + dots/extra punctuation to spaces + squeezed tokens."""

    folded = value.lower().replace('ё', 'е')
    tokens = re.sub(r'[^а-яa-z0-9]+', ' ', folded).split()
    return ' '.join(tokens)


def days_word(count: int) -> str:
    """Russian plural for vacation day counts: 1/21 день, 2-4/24 дня, 5-20 дней."""

    if count % 10 == 1 and count % 100 != 11:
        return 'день'
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return 'дня'
    return 'дней'


@dataclass(frozen=True)
class VacationPerson:
    full_name: str
    department: str | None
    # Должность from xlsx column 1 (D-F-2): the parser and ingest already
    # store it per period row; the forms wizards read the first non-null.
    position: str | None
    periods: tuple[tuple[date, int], ...]


@dataclass(frozen=True)
class Match:
    kind: str  # 'found' | 'ambiguous' | 'not_found'
    person: VacationPerson | None = None
    candidates: tuple[str, ...] = ()
    suggestions: tuple[str, ...] = ()


class VacationService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def _latest_snapshot_rows(self) -> list[VacationPeriod]:
        schedule = self._session.scalars(
            select(VacationSchedule).order_by(VacationSchedule.year.desc(), VacationSchedule.id.desc()).limit(1)
        ).first()
        if schedule is None:
            return []
        return list(
            self._session.scalars(
                select(VacationPeriod)
                .where(VacationPeriod.schedule_id == schedule.id)
                .order_by(VacationPeriod.start_date, VacationPeriod.days)
            )
        )

    def find(self, query: str) -> Match:
        rows = self._latest_snapshot_rows()
        if not rows:
            return Match(kind='not_found')
        names: dict[str, list[VacationPeriod]] = {}
        for row in rows:
            names.setdefault(row.full_name, []).append(row)
        normalized_query = normalize_name(query)
        if not normalized_query:
            return Match(kind='not_found')

        # 1. full normalized name equality — the уточнение with initials
        #    the bot itself asks for resolves here (review r2 F-R2-2)
        full_hits = [name for name in names if normalize_name(name) == normalized_query]
        # 2. surname-token equality — «Свеклов» never matches «Свеклова»
        query_surname = normalized_query.split()[0]
        token_hits = [
            name
            for name in names
            if normalize_name(name).split()[0] == query_surname
        ]
        # 3. surname-prefix candidates — «Вишневск» lists both Вишневские
        prefix_hits = [
            name
            for name in names
            if normalize_name(name).split()[0].startswith(query_surname)
        ]

        for hits in (full_hits, token_hits, prefix_hits):
            unique = sorted(set(hits))
            if len(unique) == 1:
                return Match(kind='found', person=self._person(names, unique[0]))
            if len(unique) > 1:
                return Match(kind='ambiguous', candidates=tuple(self._labels(names, name) for name in unique))

        surnames = sorted({normalize_name(name).split()[0] for name in names})
        suggestions = tuple(
            difflib.get_close_matches(query_surname, surnames, n=_SUGGESTION_COUNT, cutoff=_SUGGESTION_CUTOFF)
        )
        return Match(kind='not_found', suggestions=suggestions)

    def format_periods(self, person: VacationPerson) -> list[str]:
        """«Абрикосов Т.П. с 21.12.2026 на 7 дней», sorted by start date."""

        lines = []
        for start, days in sorted(person.periods):
            lines.append(
                f'{person.full_name} с {start.strftime("%d.%m.%Y")} на {days} {days_word(days)}'
            )
        return lines

    @staticmethod
    def _person(names: dict[str, list[VacationPeriod]], name: str) -> VacationPerson:
        rows = names[name]
        periods = tuple((row.start_date, row.days) for row in rows)
        position = next((row.position for row in rows if row.position), None)
        return VacationPerson(
            full_name=name,
            department=rows[0].department,
            position=position,
            periods=periods,
        )

    @staticmethod
    def _labels(names: dict[str, list[VacationPeriod]], name: str) -> str:
        department = names[name][0].department
        return f'{name} ({department})' if department else name
