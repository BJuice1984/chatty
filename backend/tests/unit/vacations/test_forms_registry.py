"""Form registry and sanitized-template pins (AC-TEMPLATES, wave A).

The golden bodies are the decoded text tails of the three shipped
templates: any leftover real data, a broken placeholder or an accidental
re-edit of the derivation changes them. Privacy: the structural pin —
no {\info} group — keeps the originals' author metadata (a third real
name and a legal-DB vendor marker, F-R1-2) out of the repo; the decoded
bodies themselves prove the header carries only placeholders
(D-F-10/D-F-16).
"""

from __future__ import annotations

import re

from app.vacations.forms.registry import (
    FORMS,
    attachment_filename,
    calendar_days_word,
    load_template,
)
from app.vacations.forms.rtf import template_tokens

_UNDERSCORE_RUN = re.compile(r'(?:\\u95\*){3,}')


def _decode_template(raw: bytes) -> str:
    """Best-effort body decode: text runs and tokens, groups folded."""

    text = raw.decode('latin-1')
    out: list[str] = []
    depth_skip: list[bool] = []
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == '{':
            # ignorable destinations ({\*...}) are skipped wholesale
            depth_skip.append(text[i + 1:i + 3] == '\\*')
            i += 1
            continue
        if c == '}':
            if depth_skip:
                depth_skip.pop()
            i += 1
            continue
        if c == '\\':
            m = re.match(r'\\u(\d+)\*?', text[i:i + 12])
            if m:
                if not (depth_skip and depth_skip[-1]):
                    try:
                        ch = chr(int(m.group(1)))
                        out.append(ch if ch.isprintable() else '')
                    except ValueError:
                        pass
                i += m.end()
                continue
            m = re.match(r"\\'([0-9a-fA-F]{2})", text[i:i + 4])
            if m:
                i += 4
                continue
            m = re.match(r'\\([a-zA-Z]+)(-?\d+)? ?', text[i:i + 30])
            if m:
                if not (depth_skip and depth_skip[-1]):
                    if m.group(1) in ('par', 'line', 'pard', 'sect'):
                        out.append('\n')
                    elif m.group(1) == 'tab':
                        out.append(' ')
                i += m.end()
                continue
            i += 2
            continue
        if c in '\r\n':
            i += 1
            continue
        if not (depth_skip and depth_skip[-1]):
            out.append(c)
        i += 1
    return ''.join(out)


def _normalize(text: str) -> str:
    return re.sub(r'\s+', ' ', text.replace('\x00', '')).strip()


def test_every_template_token_set_matches_the_registry() -> None:
    for spec in FORMS.values():
        raw = load_template(spec)
        assert template_tokens(raw) == set(spec.tokens), spec.id


def test_templates_carry_no_info_metadata_group() -> None:
    # F-R1-2: the originals' {\info} author group (a third real name and
    # a legal-DB vendor marker) must be absent from every shipped template
    for spec in FORMS.values():
        assert b'\\info' not in load_template(spec), spec.id


def test_signature_line_keeps_its_underscores() -> None:
    # the подпись blank stays hand-signed: exactly one \u95* cluster remains
    for spec in FORMS.values():
        body = load_template(spec).decode('latin-1')
        assert len(_UNDERSCORE_RUN.findall(body)) == 1, spec.id


def test_vacation_golden_body() -> None:
    body = _normalize(_decode_template(load_template(FORMS['vacation'])))
    assert body.endswith(_GOLDEN_VACATION)


def test_transfer_golden_body() -> None:
    body = _normalize(_decode_template(load_template(FORMS['transfer'])))
    assert body.endswith(_GOLDEN_TRANSFER)


def test_unpaid_golden_body() -> None:
    body = _normalize(_decode_template(load_template(FORMS['unpaid'])))
    assert body.endswith(_GOLDEN_UNPAID)


_GOLDEN_VACATION = (
    'org_name addressee От position (должность) full_name (ФИО) ЗАЯВЛЕНИЕ '
    'Прошу предоставить мне ежегодный основной оплачиваемый отпуск '
    'на days days_word с start_date year г. '
    'today ___________/full_name/ (дата) (подпись) (ФИО полностью)'
)

_GOLDEN_TRANSFER = (
    'org_name addressee от position full_name (должность) (ФИО) Заявление '
    'В соответствии с графиком отпусков org_name на year г. очередной '
    'оплачиваемый отпуск должен быть предоставлен мне с old_start.year г. '
    'сроком old_days old_days_word. '
    'В соответствии с абз. 4 ч. 1 ст. 124 Трудового кодекса Российской Федерации '
    'прошу перенести дату начала очередного оплачиваемого отпуска '
    'и предоставить его с new_start сроком new_days new_days_word. '
    'today year г. _________________________/full_name/'
)

_GOLDEN_UNPAID = (
    'org_name addressee от position full_name (должность и ФИО) ЗАЯВЛЕНИЕ '
    'На основании ст. 128 ТК РФ прошу предоставить мне отпуск '
    'без сохранения заработной платы продолжительностью days days_word '
    'с start_date г. today (дата) ______________________/ full_name / '
    '(подпись) (ФИО полностью)'
)


def test_calendar_days_word_pins() -> None:
    assert calendar_days_word(1) == 'календарный день'
    assert calendar_days_word(2) == 'календарных дня'
    assert calendar_days_word(5) == 'календарных дней'
    assert calendar_days_word(11) == 'календарных дней'
    assert calendar_days_word(14) == 'календарных дней'
    assert calendar_days_word(21) == 'календарный день'
    assert calendar_days_word(22) == 'календарных дня'


def test_attachment_filename() -> None:
    spec = FORMS['vacation']
    assert attachment_filename(spec, 'Абрикосов Т.П.') == 'Заявление на отпуск — Абрикосов Т.П..rtf'


def test_date_formats_declared_per_token() -> None:
    assert FORMS['vacation'].formats == {'start_date': '%d.%m', 'today': '%d.%m.%Y'}
    assert FORMS['transfer'].formats == {
        'old_start': '%d.%m',
        'new_start': '%d.%m.%Y',
        'today': '%d.%m',
    }
    assert FORMS['unpaid'].formats == {'start_date': '%d.%m.%Y', 'today': '%d.%m.%Y'}
    assert FORMS['unpaid'].has_year_slot is False
