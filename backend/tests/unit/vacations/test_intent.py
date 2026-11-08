"""Intent classifier pins (AC-INTENT): priorities and verb false-positives."""

from __future__ import annotations

import pytest

from app.vacations.intent import classify, has_cancel, has_no, has_yes, is_vacation_noun


@pytest.mark.parametrize(
    ('text', 'expected'),
    [
        ('Хочу в отпуск, но не знаю когда', 'vacation'),
        ('Как оформить отпуск?', 'vacation'),
        ('расскажи про свой отпуск', 'vacation'),
        ('Когда у меня отпуск по графику?', 'schedule'),
        ('покажи график отпусков', 'schedule'),
        ('мои даты по графику', 'schedule'),
        ('когда мой отпуск', 'schedule'),
        ('график отпусков на 2027 год', 'schedule'),
        # verb continuations never match the noun forms (D-9)
        ('меня не отпускает задача', None),
        ('отпустите меня с собрания', None),
        ('отпустить сотрудника нельзя', None),
        ('начальник не отпускает в командировку', None),
        # closed yes/no/cancel word sets, exact token match
        ('да', 'yes'),
        ('ДА', 'yes'),
        ('давай', 'yes'),
        ('конечно, покажи', 'yes'),
        ('нет', 'no'),
        ('не хочу', 'no'),
        ('позже', 'no'),
        ('отмена', 'cancel'),
        ('стоп', 'cancel'),
        # no letter-collapse rule by design
        ('дада', None),
        ('как погода?', None),
        ('', None),
    ],
)
def test_classify(text: str, expected: str | None) -> None:
    assert classify(text) == expected


def test_noun_forms_match_and_verbs_do_not() -> None:
    for noun in ('отпуск', 'отпуска', 'отпуску', 'отпуске', 'отпуском', 'отпуски', 'отпусков', 'отпускам', 'отпусках'):
        assert is_vacation_noun(noun)
    for verb in ('отпускает', 'отпускаю', 'отпускаешь', 'отпускать', 'отпускал', 'отпустите', 'отпустить'):
        assert not is_vacation_noun(verb)


def test_schedule_priority_beats_vacation() -> None:
    assert classify('хочу посмотреть график отпусков') == 'schedule'


def test_phrase_helpers_see_through_a_repeated_topic() -> None:
    # inside awaiting_yes these phrase checks run BEFORE the topic check
    assert has_yes('да, хочу в отпуск')
    assert has_no('не хочу в отпуск')
    assert not has_yes('не хочу в отпуск')
    assert has_cancel('стоп, отмена')
    assert not has_yes('дада')
