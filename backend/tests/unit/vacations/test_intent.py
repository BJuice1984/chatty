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


def test_date_noun_cooccurrence_is_schedule() -> None:
    # п.6: «даты + отпуск» is an explicit schedule question — with a
    # stored surname it must answer straight away, no offer
    assert classify('хочу узнать даты отпуска') == 'schedule'
    assert classify('подскажи даты отпуска') == 'schedule'
    assert classify('отпуск: какие даты?') == 'schedule'
    assert classify('даты отпуска на 2027 год') == 'schedule'


def test_date_like_words_are_not_schedule_markers() -> None:
    # exact noun forms only: the verb «дать» and «данные» never trigger
    assert classify('хочу дать отпуск коллеге') == 'vacation'
    assert classify('данные по отпуску пришли') == 'vacation'


def test_phrase_helpers_see_through_a_repeated_topic() -> None:
    # inside awaiting_yes these phrase checks run BEFORE the topic check
    assert has_yes('да, хочу в отпуск')
    assert has_no('не хочу в отпуск')
    assert not has_yes('не хочу в отпуск')
    assert has_cancel('стоп, отмена')
    assert not has_yes('дада')


# --- vacation-form intents (2026-11-08-vacation-forms, D-F-19) -----------------


def test_form_vacation_intent_with_application_word() -> None:
    assert classify('оформи заявление на отпуск') == 'form_vacation'
    assert classify('мне нужно заявление на отпуск') == 'form_vacation'
    assert classify('заявление о переносе отпуска') == 'form_transfer'


def test_form_transfer_intent() -> None:
    assert classify('хочу перенести отпуск') == 'form_transfer'
    assert classify('перенос отпуска на осень') == 'form_transfer'


def test_form_unpaid_intent_corroborated_phrases_only() -> None:
    assert classify('нужен отпуск за свой счёт') == 'form_unpaid'
    assert classify('отпуск без сохранения зарплаты') == 'form_unpaid'
    assert classify('дай заявление на отпуск без содержания') == 'form_unpaid'


def test_form_intents_come_before_vacation() -> None:
    # «заявление на отпуск» contains the vacation noun — the offer must lose
    assert classify('заявление на отпуск') == 'form_vacation'


def test_termination_application_is_not_a_form_intent() -> None:
    # D-F-15: no vacation noun -> nothing matches
    assert classify('заявление на увольнение') is None


def test_kak_oformit_otpusk_stays_vacation() -> None:
    # the оформить family is NOT a trigger: the parent pin survives (F-R1-4)
    assert classify('Как оформить отпуск?') == 'vacation'
    assert classify('оформить отпуск') == 'vacation'


def test_bare_billing_words_are_not_unpaid() -> None:
    assert classify('проверь счёт за квартиру') is None
    assert classify('выстави счёт') is None


def test_want_vacation_without_application_word_stays_vacation() -> None:
    assert classify('нужен отпуск') == 'vacation'
    assert classify('хочу в отпуск') == 'vacation'
