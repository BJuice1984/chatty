"""RTF renderer pins: escapes, validation, determinism (AC-RTF, wave A)."""

from __future__ import annotations

import pytest

from app.vacations.forms.registry import FORMS, load_template
from app.vacations.forms.rtf import escape_rtf_text, fill, template_tokens


def test_ascii_passes_through_and_braces_are_escaped() -> None:
    assert escape_rtf_text('plain 123') == 'plain 123'
    assert escape_rtf_text(r'a\b {c} d') == r'a\\b \{c\} d'


def test_cyrillic_becomes_decimal_u_escapes() -> None:
    # «Абрикосов Т.П.» — every Cyrillic char as \uNNNN* (the shipped
    # templates' own profile: r7-office, ansicpg0, '*' fallback byte —
    # D-F-18/F-R1-1; interpretation never depends on the reader's code page)
    expected = ''.join(
        f'\\u{ord(ch)}*' if ord(ch) > 127 or ch in '{}\\' else ch
        for ch in 'Абрикосов Т.П.'
    )
    assert escape_rtf_text('Абрикосов Т.П.') == expected
    assert escape_rtf_text('А') == '\\u1040*'
    assert escape_rtf_text('я') == '\\u1103*'


def test_beyond_bmp_degrades_to_question_mark() -> None:
    assert escape_rtf_text('emoji \U0001f600 here') == 'emoji ? here'


def test_template_tokens_reads_ascii_placeholders() -> None:
    raw = b'x {{org_name}} y {{days}} {{org_name}}'
    assert template_tokens(raw) == {'org_name', 'days'}


def test_fill_happy_path() -> None:
    raw = b'head {{name}} tail'
    out = fill(raw, {'name': 'Иван'})
    assert out == b'head ' + '\\u1048*\\u1074*\\u1072*\\u1085*'.encode() + b' tail'


def test_fill_missing_key_names_the_difference() -> None:
    raw = b'{{a}} {{b}}'
    with pytest.raises(ValueError, match='missing'):
        fill(raw, {'a': 'x'})


def test_fill_extra_key_names_the_difference() -> None:
    raw = b'{{a}}'
    with pytest.raises(ValueError, match='extra'):
        fill(raw, {'a': 'x', 'zzz': 'y'})


def test_fill_is_byte_deterministic() -> None:
    raw = load_template(FORMS['vacation'])
    values = {
        'org_name': 'ООО «Альфа-Тех»',
        'addressee': 'Смирнову А.А.',
        'position': 'финансового менеджера',
        'full_name': 'Абрикосов Т.П.',
        'full_name_gen': 'Абрикосова Т.П.',
        'days': '14',
        'days_word': 'календарных дней',
        'start_date': '05.02',
        'year': '2026',
        'today': '08.11.2026',
    }
    first = fill(raw, values)
    second = fill(raw, values)
    assert first == second
    # every value landed in the template's own escape profile and no
    # placeholder survived
    assert b'{{' not in first
    assert '\\u1040*\\u1073*\\u1088*\\u1080*\\u1082*\\u1086*\\u1089*\\u1086*\\u1074*'.encode() in first


def test_fill_real_template_with_fictional_values_is_valid_rtf_shape() -> None:
    # the unpaid form has no year slot: its start carries the full date
    raw = load_template(FORMS['unpaid'])
    out = fill(
        raw,
        {
            'org_name': 'ООО «Альфа-Тех»',
            'addressee': 'Смирнову А.А.',
            'position': 'менеджера проекта',
            'full_name': 'Абрикосов Т.П.',
            'full_name_gen': 'Абрикосова Т.П.',
            'days': '5',
            'days_word': 'календарных дней',
            'start_date': '12.01.2027',
            'today': '08.11.2026',
        },
    )
    assert out.startswith(b'{\\rtf1')
    assert b'{{' not in out
    # the hand-signed blank survives
    assert b'\\u95*\\u95*\\u95*' in out
