"""Degeneration guard: collapsing a repeated answer tail."""

from __future__ import annotations

from app.bot.generation import collapse_repeated_tail


def test_incident_shaped_two_block_loop_collapses():
    # live-инцидент 2026-11-10: два блока («Вывод…» + «Однако…») повторялись
    # до предела контекста — хвост из 4 повторов схлопывается в первый
    head = 'Интро ответа.\n\n- Первый пункт'
    unit = '**Вывод**: согласие требуется.\n\nОднако если компания платит.'
    text = f'{head}\n\n{unit}\n\n{unit}\n\n{unit}\n\n{unit}'

    assert collapse_repeated_tail(text) == f'{head}\n\n{unit}'


def test_truncated_mid_repeat_tail_still_collapses():
    # обрезка по max_answer_chars ловит генерацию посередине следующего
    # повтора: последний блок — префикс шаблона и тоже должен уйти
    unit = '**Вывод**:  \n**Да, требуется согласие**, если работник согласен.'
    text = f'Интро.\n\n{unit}\n\n{unit}\n\n{unit}\n\n**Вывод**'

    assert collapse_repeated_tail(text) == f'Интро.\n\n{unit}'


def test_unrelated_trailing_block_prevents_collapse():
    # за повторами идёт НЕ префикс шаблона — это другой контент, не трогаем
    unit = 'Хвост.'
    text = f'Ответ.\n\n{unit}\n\n{unit}\n\n{unit}\n\nСовсем другая концовка.'

    assert collapse_repeated_tail(text) == text


def test_single_block_run_collapses_to_one():
    assert collapse_repeated_tail('Ответ.\n\nХвост.\n\nХвост.\n\nХвост.') == 'Ответ.\n\nХвост.'


def test_two_repeats_are_kept():
    # два повода повторить блок легитимны (цитата/сравнение) — порог три
    text = 'Ответ.\n\nХвост.\n\nХвост.'

    assert collapse_repeated_tail(text) == text


def test_plain_answer_unchanged_byte_for_byte():
    text = 'Первый абзац.\n\nВторой абзац.\n\nТретий, другой.'

    assert collapse_repeated_tail(text) == text


def test_comparison_ignores_whitespace_differences():
    text = 'Вывод.\n\nХвост  из  двух  пробелов.\n\n  Хвост из двух пробелов.\n\nХвост\tиз двух пробелов.'

    assert collapse_repeated_tail(text) == 'Вывод.\n\nХвост  из  двух  пробелов.'


def test_repeats_from_the_very_start_still_collapse():
    text = 'Блок.\n\nБлок.\n\nБлок.\n\nБлок.'

    assert collapse_repeated_tail(text) == 'Блок.'


def test_empty_and_blank_text_unchanged():
    assert collapse_repeated_tail('') == ''
    assert collapse_repeated_tail('   ') == '   '
    assert collapse_repeated_tail('Один блок без разделителей') == 'Один блок без разделителей'
