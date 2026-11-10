"""Post-generation degeneration guard.

Live-инцидент 2026-11-10 («бесконечный цикл» бота): редкий хвостовой сбой
сэмплинга — модель повторяла один и тот же блок «Вывод…» до предела
контекста, ответ обрезался на ``max_answer_chars`` (возможно — посередине
очередного повтора) и уходил в чат стеной одинаковых абзацев. Штрафы за
повторы и лимит токенов снижают вероятность сбоя, но не гарантируют его
отсутствие у произвольной модели/провайдера — эта чистая функция
детерминированно схлопывает такой хвост: если конец ответа состоит из
одного и того же шаблона блоков (разделённых пустой строкой) три и более
раз подряд — с возможным обрезанным последним блоком — остаётся первое
вхождение шаблона.
"""

from __future__ import annotations

MIN_TAIL_REPEATS = 3


def _normalize_block(block: str) -> str:
    """Сравнение блоков нечувствительно к пробелам внутри и вокруг."""
    return ' '.join(block.split())


def _is_partial_repeat(fragment: str, pattern: list[str]) -> bool:
    """Обрезанный посередине блок — префикс нормализованного шаблона."""
    pattern_text = '\n\n'.join(pattern)

    return fragment != '' and fragment != pattern_text and pattern_text.startswith(fragment)


def collapse_repeated_tail(text: str) -> str:
    """Схлопнуть вырожденно повторяющийся хвост ответа в одно вхождение.

    Текст без периодичного хвоста (меньше трёх повторов любого шаблона
    блоков) возвращается неизменным байт-в-байт.
    """
    stripped = text.strip()

    if not stripped:
        return text

    blocks = stripped.split('\n\n')
    normalized = [_normalize_block(block) for block in blocks]
    total = len(blocks)

    # Шаблон длиной period блоков, идущий от конца; перебор от коротких —
    # одиночный повторяющийся блок находится раньше составного. skip = один
    # возможный обрезанный посередине блок за повторами (ответ подрезан по
    # лимиту символов/токенов в момент генерации того же шаблона)
    for period in range(1, total // MIN_TAIL_REPEATS + 1):
        for skip in (0, 1):
            end = total - skip

            if end < MIN_TAIL_REPEATS * period:
                continue

            pattern = normalized[end - period:end]
            repeats = 1
            start = end - period

            while start - period >= 0 and normalized[start - period:start] == pattern:
                repeats += 1
                start -= period

            if repeats < MIN_TAIL_REPEATS:
                continue

            if skip == 1 and not _is_partial_repeat(normalized[total - 1], pattern):
                continue

            kept = blocks[:start + period]

            return '\n\n'.join(kept).rstrip()

    return text


__all__ = ['collapse_repeated_tail']
