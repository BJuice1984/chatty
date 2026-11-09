"""VacationService matching and formatting pins (AC-LOOKUP)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import VacationPeriod, VacationSchedule
from app.vacations.service import VacationService, days_word


@pytest.fixture()
def session():
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as active:
        schedule = VacationSchedule(source_name='график.xlsx', year=2026, row_count=0)
        active.add(schedule)
        active.flush()
        rows = [
            ('Абрикосов Т.П.', 'Департамент Альфа', date(2026, 4, 20), 7),
            ('Абрикосов Т.П.', 'Департамент Альфа', date(2026, 8, 3), 14),
            ('Абрикосов Т.П.', 'Департамент Альфа', date(2026, 12, 21), 7),
            ('Вишневский О.Н.', 'Департамент Альфа', date(2026, 4, 29), 14),
            ('Вишневский А.А.', 'Департамент Альфа', date(2026, 7, 1), 7),
            ('Свеклов Н.Н.', 'Департамент Бета', date(2026, 8, 1), 14),
            ('Свеклова Е.Е.', 'Департамент Гамма', date(2026, 3, 9), 14),
            ('Тыквин А.А.', 'Департамент Гамма', date(2026, 4, 27), 4),
            ('Тыквин А.А.', 'Департамент Гамма', date(2026, 7, 1), 24),
            ('Персиков В.В.', 'Департамент Гамма', date(2026, 6, 1), 14),
            ('Клубников Э.Э.', 'Департамент Альфа', date(2026, 6, 18), 1),
        ]
        active.add_all(
            VacationPeriod(
                schedule_id=schedule.id,
                full_name=name,
                department=department,
                position='Инженер',
                start_date=start,
                days=days,
            )
            for name, department, start, days in rows
        )
        active.commit()
        yield active
    engine.dispose()


@pytest.fixture()
def service(session: Session) -> VacationService:
    return VacationService(session)


def test_full_name_with_initials_resolves_uniquely(service: VacationService) -> None:
    match = service.find('Вишневский А.А.')
    assert match.kind == 'found'
    assert match.person is not None
    assert match.person.full_name == 'Вишневский А.А.'
    assert match.person.periods == ((date(2026, 7, 1), 7),)


def test_exact_surname_token_returns_one_person(service: VacationService) -> None:
    # «Свеклов» must NOT match «Свеклова Е.Е.» (the stricter D-7 rule)
    match = service.find('Свеклов')
    assert match.kind == 'found'
    assert match.person.full_name == 'Свеклов Н.Н.'


def test_bare_surname_with_two_carriers_is_ambiguous(service: VacationService) -> None:
    match = service.find('Вишневский')
    assert match.kind == 'ambiguous'
    assert 'Вишневский О.Н. (Департамент Альфа)' in match.candidates
    assert 'Вишневский А.А. (Департамент Альфа)' in match.candidates


def test_surname_prefix_also_lists_candidates(service: VacationService) -> None:
    match = service.find('Вишневск')
    assert match.kind == 'ambiguous'
    assert len(match.candidates) == 2


def test_unknown_surname_answers_bare_not_found(service: VacationService) -> None:
    # no similar-surname hints — the bot must not list employees (п.7)
    match = service.find('Абрикосова')
    assert match.kind == 'not_found'
    assert match.person is None
    assert not match.candidates


def test_normalization_case_and_yo(service: VacationService) -> None:
    assert service.find('АБРИКОСОВ').kind == 'found'
    assert service.find('абрикосов т.п.').kind == 'found'
    assert service.find('Ёлкин').kind == 'not_found'


def test_format_periods_sorted_with_russian_plurals(service: VacationService) -> None:
    match = service.find('Абрикосов')
    assert match.kind == 'found'
    assert service.format_periods(match.person) == [
        'Абрикосов Т.П. с 20.04.2026 на 7 дней',
        'Абрикосов Т.П. с 03.08.2026 на 14 дней',
        'Абрикосов Т.П. с 21.12.2026 на 7 дней',
    ]

    tykvin = service.find('Тыквин')
    assert service.format_periods(tykvin.person) == [
        'Тыквин А.А. с 27.04.2026 на 4 дня',
        'Тыквин А.А. с 01.07.2026 на 24 дня',
    ]

    klubnikov = service.find('Клубников')
    assert service.format_periods(klubnikov.person) == ['Клубников Э.Э. с 18.06.2026 на 1 день']


def test_days_word_plural_rules() -> None:
    assert days_word(1) == 'день'
    assert days_word(21) == 'день'
    assert days_word(2) == 'дня'
    assert days_word(4) == 'дня'
    assert days_word(24) == 'дня'
    assert days_word(5) == 'дней'
    assert days_word(14) == 'дней'


def test_lookup_uses_only_the_latest_snapshot(session: Session, service: VacationService) -> None:
    newer = VacationSchedule(source_name='график.xlsx', year=2027, row_count=0)
    session.add(newer)
    session.flush()
    session.add(
        VacationPeriod(
            schedule_id=newer.id,
            full_name='Абрикосов Т.П.',
            department='Департамент Альфа',
            position=None,
            start_date=date(2027, 3, 2),
            days=14,
        )
    )
    session.commit()

    match = service.find('Абрикосов')
    assert match.kind == 'found'
    assert match.person.periods == ((date(2027, 3, 2), 14),)


def test_found_person_carries_position_from_the_schedule(service: VacationService) -> None:
    # D-F-2 (operator correction): должность is xlsx column 1 — already
    # stored per period row; VacationService exposes the first non-null
    match = service.find('Абрикосов')
    assert match.kind == 'found'
    assert match.person is not None
    assert match.person.position == 'Инженер'


def test_position_takes_the_first_non_null_row(session: Session, service: VacationService) -> None:
    # a dirty schedule may leave должность empty on some rows only
    schedule = session.scalars(select(VacationSchedule)).one()
    session.add(
        VacationPeriod(
            schedule_id=schedule.id,
            full_name='Рябинов С.С.',
            department='Департамент Дельта',
            position=None,
            start_date=date(2026, 5, 4),
            days=14,
        )
    )
    session.add(
        VacationPeriod(
            schedule_id=schedule.id,
            full_name='Рябинов С.С.',
            department='Департамент Дельта',
            position='Ведущий аналитик',
            start_date=date(2026, 9, 7),
            days=7,
        )
    )
    session.commit()
    match = service.find('Рябинов')
    assert match.kind == 'found'
    assert match.person is not None
    assert match.person.position == 'Ведущий аналитик'
