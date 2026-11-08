"""Deterministic intent classification for the vacation skill.

The vacation-noun test IS the verb guard: a word counts only when it
ENDS at a noun suffix (отпуск/отпуска/отпуску/отпуске/отпуском/
отпуски/отпусков/отпускам/отпусках), so verb continuations
(«отпускает», «отпускаю», «отпустить») never match, while
«отпустите» does not even share the stem (D-9, review r1 F-3 — the
earlier negative-lookahead formulation was dead code).
"""

from __future__ import annotations

import re

_YES_WORDS = frozenset({'да', 'давай', 'хочу', 'узнать', 'покажи', 'конечно', 'ага', 'ок', 'окей'})
_NO_WORDS = frozenset({'нет', 'неа', 'не хочу', 'не надо', 'позже', 'не нужно'})
_CANCEL_WORDS = frozenset({'отмена', 'отменить', 'стоп', 'пропустить'})

_SCHEDULE_WINDOW = 5
_WHEN_MY_RE = re.compile(r'\bкогда (?:мой|моя|моё|мои)\b')
_WORD_RE = re.compile(r'[а-яa-z0-9-]+')


def normalize(text: str) -> str:
    return (text or '').lower().replace('ё', 'е').strip()


def words(text: str) -> list[str]:
    return _WORD_RE.findall(normalize(text))


def is_vacation_noun(word: str) -> bool:
    """True only for exact noun forms; verb continuations stay False."""

    return re.fullmatch(r'отпуск(?:а|у|е|ом|и|ов|ам|ах)?', word) is not None


def _mentions_schedule(text: str) -> bool:
    tokens = words(text)
    for index, token in enumerate(tokens):
        if token.startswith('график'):
            if any(is_vacation_noun(other) for other in tokens[index + 1 : index + 1 + _SCHEDULE_WINDOW]):
                return True
        if is_vacation_noun(token):
            if any(other.startswith('график') for other in tokens[index + 1 : index + 1 + _SCHEDULE_WINDOW]):
                return True
    if 'мои даты' in text:
        return True
    if _WHEN_MY_RE.search(text) and any(is_vacation_noun(token) for token in tokens):
        return True
    return False


def _matches_wordset(text: str, candidates: frozenset[str]) -> bool:
    tokens = set(words(text))
    for candidate in candidates:
        if ' ' in candidate:
            if candidate in text:
                return True
        elif candidate in tokens:
            return True
    return False


def has_yes(text: str) -> bool:
    # «не хочу» is a decline even though it contains the yes-word «хочу»
    return _matches_wordset(text, _YES_WORDS) and not has_no(text)


def has_no(text: str) -> bool:
    return _matches_wordset(text, _NO_WORDS)


def has_cancel(text: str) -> bool:
    return _matches_wordset(text, _CANCEL_WORDS)


def classify(content: str) -> str | None:
    """'schedule' | 'vacation' | 'yes' | 'no' | 'cancel' | None, in that priority."""

    text = normalize(content)
    if not text:
        return None
    if _mentions_schedule(text):
        return 'schedule'
    if any(is_vacation_noun(token) for token in words(text)):
        return 'vacation'
    if has_cancel(text):
        return 'cancel'
    if has_no(text):
        return 'no'
    if has_yes(text):
        return 'yes'
    return None
