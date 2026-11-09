"""Vacation skill state machine: the deterministic pre-RAG branch of the bot.

Flow (operator request 2026-11-08): a generic vacation message gets the
exact offer «Хотите узнать свои даты по графику отпусков?»; an explicit
schedule message skips the offer; «да» without a stored surname asks for
it once, validates against the schedule and persists the canonical
name; «нет» passes the ORIGINAL question back to the normal RAG+LLM
path; cancel words exit without burning an attempt; a stored surname
that vanished from a refreshed snapshot is deleted and re-asked once
(D-15). Lookups use only the user's stored name or their direct answer
to the surname question — there is no lookup by an arbitrary surname
from a fresh message (D-2).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.bot.provider import BotProvider, BotProviderError
from app.vacations import prompts
from app.vacations.intent import classify, has_cancel, has_no, has_yes, is_form_intent, normalize
from app.vacations.service import Match, VacationService
from app.vacations.store import VacationStore
from app.vacations.surname_flow import (
    MAX_SURNAME_ATTEMPTS,
    STALE_SCHEDULE_PREFIX,
    SURNAME_QUESTION,
    resolve_answer,
)

logger = logging.getLogger(__name__)

OFFER_TEXT = 'Хотите узнать свои даты по графику отпусков?'


@dataclass(frozen=True)
class SkillOutcome:
    """reply — post as the bot answer; passthrough_question — run the normal
    path with the original question instead; None fields — not this skill."""

    reply: str | None = None
    passthrough_question: str | None = None


class VacationSkill:
    def __init__(self, session: Session, provider: BotProvider) -> None:
        self._session = session
        self._provider = provider
        self._store = VacationStore(session)
        self._service = VacationService(session)

    def handle(self, *, content: str, user_id: int) -> SkillOutcome | None:
        state = self._store.get_state(user_id)
        if state is not None:
            if state.state == 'awaiting_yes':
                return self._awaiting_yes(content, user_id, state.origin_content)
            if state.state == 'awaiting_surname':
                return self._awaiting_surname(content, user_id, state.attempts)
        return self._fresh(content, user_id)

    # --- fresh message -------------------------------------------------------

    def _fresh(self, content: str, user_id: int) -> SkillOutcome | None:
        kind = classify(content)
        if is_form_intent(kind):
            # the forms skill owns application phrasing (D-F-12) — never
            # answer «оформи заявление на отпуск» with the dates offer
            return None
        if kind == 'schedule':
            return self._answer_or_ask(user_id)
        if kind == 'vacation':
            self._store.set_state(user_id, 'awaiting_yes', origin_content=content)
            return SkillOutcome(reply=OFFER_TEXT)
        return None

    # --- awaiting the yes/no answer ------------------------------------------

    def _awaiting_yes(self, content: str, user_id: int, origin_content: str | None) -> SkillOutcome:
        # yes/no phrases win over a repeated vacation topic: «да, хочу в
        # отпуск» is consent, «не хочу в отпуск» is a decline (D-15)
        if has_no(content):
            self._store.clear_state(user_id)
            return SkillOutcome(passthrough_question=origin_content or content)
        if has_cancel(content):
            self._store.clear_state(user_id)
            return SkillOutcome(reply='Хорошо, не буду показывать даты отпуска.')
        if has_yes(content):
            self._store.clear_state(user_id)
            return self._answer_or_ask(user_id)
        kind = classify(content)
        if kind in ('vacation', 'schedule'):
            # the user restated the topic — refresh the origin and re-offer
            self._store.set_state(user_id, 'awaiting_yes', origin_content=content)
            return SkillOutcome(reply=OFFER_TEXT)
        # an unrelated message resets the pending state and takes the normal path
        self._store.clear_state(user_id)
        return SkillOutcome()

    # --- awaiting the surname -------------------------------------------------

    def _awaiting_surname(self, content: str, user_id: int, attempts: int) -> SkillOutcome:
        if has_cancel(content):
            self._store.clear_state(user_id)
            return SkillOutcome(reply='Хорошо, спросим позже — просто напишите про отпуск.')
        resolution = resolve_answer(self._service, self._store, user_id, content, attempts)
        if resolution.found is not None:
            self._store.clear_state(user_id)
            return SkillOutcome(reply=self._compose_answer(resolution.found))
        if resolution.exhausted:
            self._store.clear_state(user_id)
        return SkillOutcome(reply=resolution.reply)

    # --- answer composition ---------------------------------------------------

    def _answer_or_ask(self, user_id: int) -> SkillOutcome:
        surname = self._store.get_surname(user_id)
        if surname is None:
            self._store.set_state(user_id, 'awaiting_surname')
            return SkillOutcome(reply=SURNAME_QUESTION)
        match = self._service.find(surname)
        if match.kind == 'found':
            return SkillOutcome(reply=self._compose_answer(match))
        # the stored name no longer resolves: the schedule was re-ingested
        # without this person (D-15) — drop the stale name and re-ask once
        self._store.delete_surname(user_id)
        self._store.set_state(user_id, 'awaiting_surname')
        return SkillOutcome(reply=f'{STALE_SCHEDULE_PREFIX} {SURNAME_QUESTION}')

    def _compose_answer(self, match: Match) -> str:
        lines = self._service.format_periods(match.person)
        try:
            answer = self._provider.complete(prompts.build_vacation_messages(lines))
        except BotProviderError:
            logger.warning('vacation answer provider failed, using the template', exc_info=True)
            return '\n'.join(lines)
        text = answer.strip() if isinstance(answer, str) else ''
        return text or '\n'.join(lines)


__all__ = ['OFFER_TEXT', 'SURNAME_QUESTION', 'STALE_SCHEDULE_PREFIX', 'MAX_SURNAME_ATTEMPTS', 'SkillOutcome', 'VacationSkill', 'normalize']
