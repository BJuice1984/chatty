"""LLM phrasing for vacation answers: structured data only, never RAG chunks (D-10)."""

from __future__ import annotations

SYSTEM_RULE = (
    'Ты помощник, который отвечает на вопрос о датах отпуска. Отвечай '
    'ТОЛЬКО по строкам данных ниже: не выдумывай и не добавляй даты, '
    'обращайся к пользователю по имени из данных, отвечай кратко и по-русски.'
)


def build_vacation_messages(person_lines: list[str]) -> list[dict[str, str]]:
    """System rule + the structured period lines; no chunks ever enter here."""

    return [
        {'role': 'system', 'content': SYSTEM_RULE},
        {'role': 'user', 'content': 'Даты отпуска из графика:\n' + '\n'.join(person_lines)},
    ]
