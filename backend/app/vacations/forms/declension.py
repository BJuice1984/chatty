"""Deterministic Russian case declension for the application header.

The header requisites arrive in the nominative — the schedule xlsx
columns, the operator env, free-text wizard answers — but the document
prints them declined: the addressee line in the dative («Заместителю
генерального директора ... Киричуку А.В.»), the author block after
«от» in the genitive («от Инженера-программиста Сибгатуллина И.Р.»).
Before this module the values went into the RTF verbatim and the header
came out ungrammatical.

The wizards stay LLM-free (the D-F-6 rule): everything here is a
deterministic pymorphy3 word inflection plus a closed suffix-rule table
for surnames the dictionary does not know.

Design constraints pinned by tests:

- only a word whose BEST parse is a nominative declinable form inflects,
  so already-declined operator input passes through untouched — and the
  choice never falls through to a non-best nominative variant (that
  would turn the genitive «директора» into the dative «директорам»);
- a capitalized mid-phrase word declines only when its best parse is a
  person name (Surn/Name/Patrn nominative): «Киричук» declines, «Линукс»
  stays a proper noun;
- abbreviations («Вед.», «А.В.», «упр.»), all-caps tokens («ООО», «ОЗИ»,
  «ПО», «ИТ») and everything inside «...» quotes never change;
- hyphenated compounds decline every part except indeclinable heads
  («офис-менеджер» → «офис-менеджера» while «инженер-программист» →
  «инженера-программиста»).
"""

from __future__ import annotations

import re

import pymorphy3

_analyser: pymorphy3.MorphAnalyzer | None = None

# a full Cyrillic word, optionally hyphen-joined («инженер-программист»)
_CYR_WORD = re.compile(r'^[А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)*$')
# «Вед.специалист», «и.о.начальника» — dotted abbreviation head + word
_ABBREV_HEAD = re.compile(r'^((?:[А-ЯЁа-яё]{1,4}\.)+)([А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)*)$')
# quoted spans («Крафттек») and plain whitespace-separated tokens
_TOKEN = re.compile(r'«[^»]*»|\S+')

_DECLINABLE_POS = frozenset({'NOUN', 'ADJF', 'ADJS', 'PRTF', 'PRTS'})
_PERSON_GRAMMEMES = ('Surn', 'Name', 'Patr')

# first parts of hyphenated compounds that never decline
# (Rosenthal: усечённые/неизменяемые первые части)
_INDECLINABLE_HYPHEN_HEADS = frozenset(
    {'офис', 'бизнес', 'веб', 'пресс', 'контент', 'топ', 'ит', 'айти', 'фарма'}
)

# Surname suffix fallback for words pymorphy3 does not know at all
# («Сямин»): ending (lowercase) -> (genitive, dative) replacements;
# '' means the surname does not decline. Order matters: specific first.
_SURNAME_ENDINGS: tuple[tuple[str, tuple[str, str]], ...] = (
    ('их', ('', '')),
    ('ых', ('', '')),
    ('о', ('', '')),
    ('ова', ('ой', 'ой')),
    ('ева', ('ой', 'ой')),
    ('ёва', ('ой', 'ой')),
    ('ина', ('ой', 'ой')),
    ('ына', ('ой', 'ой')),
    ('ая', ('ой', 'ой')),
    ('яя', ('ой', 'ой')),
    ('ский', ('ского', 'скому')),
    ('цкий', ('цкого', 'цкому')),
    ('кой', ('кого', 'кому')),
    ('гой', ('гого', 'гому')),
    ('хой', ('хого', 'хому')),
    ('ой', ('ого', 'ому')),
    ('ый', ('ого', 'ому')),
    ('кий', ('кого', 'кому')),
    ('гий', ('гого', 'гому')),
    ('хий', ('хого', 'хому')),
    ('ний', ('него', 'нему')),
    ('ий', ('его', 'ему')),
    ('ец', ('ца', 'цу')),
)
_HUSH = frozenset('кгхжшщч')


def _analyzer() -> pymorphy3.MorphAnalyzer:
    global _analyser
    if _analyser is None:
        _analyser = pymorphy3.MorphAnalyzer(lang='ru')
    return _analyser


def _restore_case(source: str, declined: str) -> str:
    """Keep the capitalization profile; a source without «ё» never
    gains one (the schedule writes «Журавлев», so «Журавлёва» is out)."""

    if source[:1].isupper():
        declined = declined[:1].upper() + declined[1:]
    if 'ё' not in source.lower():
        declined = declined.replace('ё', 'е').replace('Ё', 'Е')
    return declined


def _case_index(case: str) -> int:
    return 0 if case == 'gent' else 1


def decline_surname(word: str, case: str) -> str:
    """Decline one surname (the nominative form as printed in the
    schedule). Dictionary route first: a nominative parse marked as a
    person form (Surn/Name/Patrn), then an animate noun or a masculine
    adjective (Lugovskoy-type); the suffix table is the OOV fallback."""

    if not _CYR_WORD.match(word):
        return word
    index = _case_index(case)
    for parse in _analyzer().parse(word):
        tag = parse.tag
        if tag.case == 'nomn' and any(g in tag.grammemes for g in _PERSON_GRAMMEMES):
            inflected = parse.inflect({case})
            if inflected is not None:
                return _restore_case(word, inflected.word)
    for parse in _analyzer().parse(word):
        tag = parse.tag
        if tag.case != 'nomn':
            continue
        if tag.POS == 'NOUN' and 'anim' in tag.grammemes:
            inflected = parse.inflect({case})
            if inflected is not None:
                return _restore_case(word, inflected.word)
    for parse in _analyzer().parse(word):
        tag = parse.tag
        if tag.case == 'nomn' and tag.POS == 'ADJF' and tag.gender == 'masc':
            inflected = parse.inflect({case})
            if inflected is not None:
                return _restore_case(word, inflected.word)

    lowered = word.lower()
    for ending, replacements in _SURNAME_ENDINGS:
        if lowered.endswith(ending) and len(lowered) > len(ending):
            replacement = replacements[index]
            return _restore_case(word, lowered[: -len(ending)] + replacement) if replacement else word
    if lowered.endswith(('а', 'я')):
        stem = lowered[:-1]
        if case == 'gent':
            replacement = 'и' if lowered[-2:-1] in _HUSH else 'ы'
        else:
            replacement = 'и' if lowered.endswith('я') else 'е'
        return _restore_case(word, stem + replacement)
    if lowered.endswith(('ь', 'ие', 'ья')):
        # soft/foreign endings are ambiguous (Таль vs Медведь): keep
        return word
    return _restore_case(word, lowered + ('а' if case == 'gent' else 'у'))


def _inflect_part(part: str, case: str) -> str:
    """Inflect ONE lowercase-or-first hyphen part. A noun inflects only
    on its BEST parse («директора» is a genitive and must stay — taking
    its plural-nominative variant would produce «директорам»); an
    adjective may fall through to a nominative parse, because the masc
    nominative «-ой/-ый» collides with the feminine genitive («сетевой»
    parses best as femn gent while the phrase needs masc nomn)."""

    parses = _analyzer().parse(part)
    chosen = None
    for index, parse in enumerate(parses):
        tag = parse.tag
        if tag.POS not in _DECLINABLE_POS:
            continue
        if tag.case == 'nomn':
            chosen = parse
            break
        if index == 0 and tag.POS != 'ADJF':
            return part  # a non-nominative noun never re-declines
    if chosen is None:
        return part
    inflected = chosen.inflect({case})
    if inflected is None:
        return part
    return _restore_case(part, inflected.word)


def _inflect_word(word: str, case: str, first: bool) -> str:
    if not _CYR_WORD.match(word) or word.isupper() or '.' in word:
        return word
    if word[0].isupper() and not first:
        # mid-phrase capitalization: a person name declines, a proper
        # noun (Линукс, Windows-style product titles) does not
        tag = _analyzer().parse(word)[0].tag
        if not any(g in tag.grammemes for g in _PERSON_GRAMMEMES):
            return word
    parts = word.split('-')
    declined: list[str] = []
    for index, part in enumerate(parts):
        if part.isupper() or (
            index < len(parts) - 1 and part.lower() in _INDECLINABLE_HYPHEN_HEADS
        ):
            declined.append(part)
            continue
        declined.append(_inflect_part(part, case))
    return '-'.join(declined)


def _inflect_phrase(text: str, case: str) -> str:
    out: list[str] = []
    first = True
    for token in _TOKEN.findall(text.strip()):
        if token.startswith('«'):
            out.append(token)
            continue
        match = _ABBREV_HEAD.match(token)
        if match is not None:
            out.append(match.group(1) + _inflect_word(match.group(2), case, first))
        else:
            out.append(_inflect_word(token, case, first))
        if _CYR_WORD.match(token.strip('«».,()')):
            first = False
    return ' '.join(out)


def dative_addressee(addressee: str) -> str:
    """The header addressee line in the dative. Accepts both the
    nominative («Генеральный директор ... Иванов И.И.») and an
    already-declined operator value — the latter passes through."""

    return _inflect_phrase(addressee, 'datv')


def genitive_position(position: str) -> str:
    """The author's должность after «от» in the genitive; non-nominative
    dependents («по закупкам», «персоналом») stay as they are."""

    return _inflect_phrase(position, 'gent')


def genitive_full_name(full_name: str) -> str:
    """«Сибгатуллин И.Р.» -> «Сибгатуллина И.Р.»: the surname (the first
    non-initial word) declines, the initials never change."""

    words = full_name.split()
    declined: list[str] = []
    surname_done = False
    for word in words:
        is_initial = bool(re.fullmatch(r'[А-ЯЁ]\.?[А-ЯЁ]?\.?', word.strip()))
        if not surname_done and not is_initial and _CYR_WORD.match(word):
            declined.append(decline_surname(word, 'gent'))
            surname_done = True
        else:
            declined.append(word)
    return ' '.join(declined)
