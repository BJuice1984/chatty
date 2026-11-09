"""The shared surname ask/validate/persist loop (D-F-13).

Extracted verbatim from the vacation skill so the forms wizards answer
the surname question with exactly the same UX: token-exact matching,
the ambiguity list, two attempts, and persistence of the canonical
schedule name on success. Misses never list similar surnames — the bot
must not enumerate employees to whoever asks (operator request
2026-11-09, backlog NEXT.md п.7). The parent skill keeps its own state
machine; only the reply texts and the resolution rules live here.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.vacations.service import Match, VacationService
from app.vacations.store import VacationStore

SURNAME_QUESTION = 'Подскажите вашу фамилию — найду вас в графике отпусков.'
STALE_SCHEDULE_PREFIX = 'График отпусков обновился, и вашей сохранённой фамилии в нём больше нет.'
MAX_SURNAME_ATTEMPTS = 2


@dataclass(frozen=True)
class SurnameResolution:
    """One answer to the surname question.

    found is set when the person resolved (the canonical name is already
    persisted); exhausted means the attempt budget is spent and the
    caller should end its flow; reply is the bot text ('' with found).
    """

    reply: str
    found: Match | None = None
    exhausted: bool = False


def resolve_answer(
    service: VacationService,
    store: VacationStore,
    user_id: int,
    content: str,
    attempts: int,
) -> SurnameResolution:
    """Validate one surname answer; persist the canonical name on success."""

    match = service.find(content)
    if match.kind == 'found':
        store.save_surname(user_id, match.person.full_name)
        return SurnameResolution(reply='', found=match)
    store.bump_attempts(user_id)
    if match.kind == 'ambiguous':
        listed = '; '.join(match.candidates)
        if attempts + 1 >= MAX_SURNAME_ATTEMPTS:
            return SurnameResolution(
                reply=f'Всё ещё неоднозначно: {listed}. Начните заново, написав про отпуск.',
                exhausted=True,
            )
        return SurnameResolution(reply=f'В графике несколько таких людей: {listed}. Уточните с инициалами.')
    if attempts + 1 >= MAX_SURNAME_ATTEMPTS:
        return SurnameResolution(
            reply='Не нашёл вас в графике отпусков. Уточните у HR — и напишите мне про отпуск позже, я начну заново.',
            exhausted=True,
        )
    return SurnameResolution(reply='Такой фамилии в графике нет. Попробуйте ещё раз.')
