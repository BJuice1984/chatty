"""VacationFormsSkill: the three application wizards (wave WS-BE-FORMS-B).

Deterministic state machines over assistant_dialog_state with states
``form:<kind>:<step>`` (a CLOSED dictionary — every step is unit-pinned
to fit the String(32) column, D-F-11) and a payload JSON blob carrying
the collected data. The wizards ask only what the schedule cannot
answer: фамилия (shared surname_flow UX, D-F-13), должность when the
график row lacks it (D-F-2), and the dates the form still needs
(D-F-3). Answers are fully deterministic — no LLM calls (D-F-6) — and
generation is byte-deterministic RTF filling; the file is delivered as
a chat attachment by BotService (D-F-5).

Flows: vacation — period confirm/choice (custom dates allowed) → summary
confirm; transfer — the OLD period comes from the schedule first, then
the new dates (days default to the old period's) → summary; unpaid —
dates always asked (both parts required) → summary.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.vacations.config import vacation_settings_from_env
from app.vacations.forms.registry import FORMS, attachment_filename, calendar_days_word, load_template
from app.vacations.forms.rtf import fill
from app.vacations.intent import classify, has_cancel, has_no, has_yes, normalize
from app.vacations.service import VacationPerson, VacationService, days_word
from app.vacations.store import VacationStore
from app.vacations.surname_flow import (
    STALE_SCHEDULE_PREFIX,
    SURNAME_QUESTION,
    resolve_answer,
)

logger = logging.getLogger(__name__)

FORM_STATE_PREFIX = 'form:'
MAX_STATE_LEN = 32
MAX_PARSE_ATTEMPTS = 2
MAX_POSITION_CHARS = 120
CONTENT_TYPE = 'application/rtf'

REQUISITES_REFUSAL = (
    'Не могу оформить заявление: в настройках не указаны реквизиты организации для шапки. '
    'Попросите оператора задать CHATTY_VACATION_ORG_NAME и CHATTY_VACATION_ADDRESSEE_NAME '
    '(docs/deployment/vacation-forms.md).'
)
CANCEL_ACK = 'Хорошо, отменяю оформление заявления.'
DECLINE_ACK = 'Отменил оформление. Напишите про отпуск, если нужны даты, или попросите заявление позже.'
DATE_QUESTION = 'С какой даты и на сколько календарных дней? Например: с 05.02.2026 на 14 дней'
BAD_DATE_HINT = (
    'Не понял дату. Напишите, пожалуйста, в формате «с 05.02.2026 на 14 дней» '
    '(день.месяц.год и количество дней).'
)

# the CLOSED step dictionary: unit-pinned against the String(32) column (D-F-11)
_STEP_NAMES = ('surname', 'position', 'choose_period', 'confirm_period', 'dates', 'confirm')
STEP_DICTIONARY = tuple(f'{FORM_STATE_PREFIX}{kind}:{step}' for kind in FORMS for step in _STEP_NAMES)

_DATE_RE = re.compile(r'\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b')
_INT_RE = re.compile(r'\b(\d{1,3})\b')

_FORM_KIND_BY_INTENT = {
    'form_vacation': 'vacation',
    'form_transfer': 'transfer',
    'form_unpaid': 'unpaid',
}


@dataclass(frozen=True)
class GeneratedForm:
    filename: str
    content_type: str
    body: bytes


@dataclass(frozen=True)
class FormsOutcome:
    """reply — post as the bot answer (attachment rides along);
    passthrough_question — run the normal path with it instead;
    all-None — not this skill (the parent skill / normal path go next)."""

    reply: str | None = None
    passthrough_question: str | None = None
    attachment: GeneratedForm | None = None


def parse_user_dates(text: str, default_year: int) -> tuple[date | None, int | None]:
    """«с 05.02.2026 на 14 дней» -> (date(2026, 2, 5), 14); days optional."""

    normalized = normalize(text)
    start: date | None = None
    rest = normalized
    match = _DATE_RE.search(normalized)
    if match is not None:
        year = int(match.group(3)) if match.group(3) else default_year
        try:
            start = date(year, int(match.group(2)), int(match.group(1)))
        except ValueError:
            start = None
        else:
            rest = normalized[: match.start()] + ' ' + normalized[match.end():]
    days: int | None = None
    if start is not None:
        candidate = _INT_RE.search(rest)
        if candidate is not None:
            value = int(candidate.group(1))
            if 1 <= value <= 365:
                days = value
    return start, days


def _period_line(start: date, days: int) -> str:
    return f'с {start.strftime("%d.%m.%Y")} на {days} {days_word(days)}'


def _dump(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


class VacationFormsSkill:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._store = VacationStore(session)
        self._service = VacationService(session)
        self._settings = vacation_settings_from_env()

    # --- entry -----------------------------------------------------------------

    def handle(self, *, content: str, user_id: int) -> FormsOutcome | None:
        state = self._store.get_state(user_id)
        if state is not None and state.state.startswith(FORM_STATE_PREFIX):
            return self._continue(state.state, state.payload, state.attempts, content, user_id)
        kind = _FORM_KIND_BY_INTENT.get(classify(content) or '')
        if kind is None:
            return None
        return self._start(kind, user_id)

    # --- start -------------------------------------------------------------------

    def _start(self, kind: str, user_id: int) -> FormsOutcome:
        if not self._settings.org_name or not self._settings.addressee_name:
            # no dialog state is created while the requisites are unset (AC-WIZARD 13)
            return FormsOutcome(reply=REQUISITES_REFUSAL)
        # a fresh wizard start pivots away from any pending parent state (D-F-12)
        self._store.clear_state(user_id)
        question, person = self._lookup_person(kind, user_id)
        return self._after_person(kind, question, person, user_id)

    def _lookup_person(self, kind: str, user_id: int) -> tuple[str | None, VacationPerson | None]:
        surname = self._store.get_surname(user_id)
        if surname is not None:
            match = self._service.find(surname)
            if match.kind == 'found':
                return None, match.person
            # the stored name no longer resolves after a re-ingest: drop it
            self._store.delete_surname(user_id)
            prefix = f'{STALE_SCHEDULE_PREFIX} '
        else:
            prefix = ''
        self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:surname', payload=_dump({'kind': kind}))
        return f'{prefix}{SURNAME_QUESTION}', None

    def _after_person(
        self,
        kind: str,
        question: str | None,
        person: VacationPerson | None,
        user_id: int,
        position: str | None = None,
    ) -> FormsOutcome:
        if person is None:
            return FormsOutcome(reply=question)
        if person.position is None and position is None:
            # a dirty schedule row without должность (D-F-2): ask for this
            # one form, no persistence
            self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:position', payload=_dump({'kind': kind}))
            return FormsOutcome(reply='Какая у вас должность для шапки заявления?')
        return self._ask_period(kind, user_id, person, position=position)

    # --- period selection ----------------------------------------------------------

    def _ask_period(
        self,
        kind: str,
        user_id: int,
        person: VacationPerson,
        position: str | None = None,
    ) -> FormsOutcome:
        if kind == 'unpaid':
            payload = {'kind': kind}
            if position is not None:
                payload['position'] = position
            self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:dates', payload=_dump(payload))
            return FormsOutcome(reply=f'{DATE_QUESTION}.')
        periods = sorted(person.periods)
        payload: dict = {'kind': kind}
        if position is not None:
            payload['position'] = position
        if len(periods) == 1:
            start, days = periods[0]
            payload.update(start=start.isoformat(), days=days, year=start.year,
                           periods=[[start.isoformat(), days]])
            self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:confirm_period', payload=_dump(payload))
            return FormsOutcome(
                reply=(
                    f'В графике: {_period_line(start, days)}. '
                    f'{FORMS[kind].title}: оформить с этими датами? (да / напишите свою дату)'
                )
            )
        payload['periods'] = [[start.isoformat(), days] for start, days in periods]
        self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:choose_period', payload=_dump(payload))
        lines = '\n'.join(f'{i + 1}) {_period_line(start, days)}' for i, (start, days) in enumerate(periods))
        return FormsOutcome(reply=f'Ваши периоды по графику:\n{lines}\nНапишите номер периода — или свою дату.')

    # --- the running wizard -----------------------------------------------------------

    def _continue(
        self,
        state: str,
        payload_raw: str | None,
        attempts: int,
        content: str,
        user_id: int,
    ) -> FormsOutcome:
        payload = json.loads(payload_raw or '{}')
        kind = payload.get('kind') or 'vacation'
        step = state.rsplit(':', 1)[1]

        if has_cancel(content):
            self._store.clear_state(user_id)
            return FormsOutcome(reply=CANCEL_ACK)

        if step == 'surname':
            resolution = resolve_answer(self._service, self._store, user_id, content, attempts)
            if resolution.found is not None:
                return self._after_person(kind, None, resolution.found.person, user_id)
            if resolution.exhausted:
                self._store.clear_state(user_id)
            return FormsOutcome(reply=resolution.reply)

        if step == 'position':
            position = content.strip()[:MAX_POSITION_CHARS]
            if len(position) < 2 or any(ch.isdigit() for ch in position):
                return FormsOutcome(reply='Должность не понятна. Напишите её текстом, например: финансовый менеджер')
            person = self._find_stored(user_id)
            if person is None:
                question, none_person = self._lookup_person(kind, user_id)
                return self._after_person(kind, question, none_person, user_id)
            return self._ask_period(kind, user_id, person, position=position)

        if step == 'choose_period':
            return self._choose_period(payload, kind, attempts, content, user_id)

        if step == 'confirm_period':
            return self._confirm_period(payload, kind, attempts, content, user_id)

        if step == 'dates':
            return self._collect_dates(payload, kind, attempts, content, user_id)

        if step == 'confirm':
            if has_yes(content):
                return self._generate(payload, kind, user_id)
            if has_no(content):
                self._store.clear_state(user_id)
                return FormsOutcome(reply=DECLINE_ACK)
            return FormsOutcome(reply='Оформить заявление? Ответьте «да» или «нет».')

        # an unknown step resets defensively instead of looping forever
        self._store.clear_state(user_id)
        return FormsOutcome()

    # --- steps ------------------------------------------------------------------------

    def _choose_period(
        self,
        payload: dict,
        kind: str,
        attempts: int,
        content: str,
        user_id: int,
    ) -> FormsOutcome:
        periods = payload.get('periods') or []
        stripped = content.strip()
        if stripped.isdigit():
            index = int(stripped) - 1
            if periods and 0 <= index < len(periods):
                iso, days = periods[index][0], periods[index][1]
                return self._period_selected({**payload, 'start': iso, 'days': days, 'year': int(iso[:4])}, kind, user_id)
            return FormsOutcome(reply='Нет такого номера. Напишите номер периода или свою дату.')
        if kind == 'transfer':
            # transfer needs the OLD period first — a bare date is ambiguous
            if attempts + 1 >= MAX_PARSE_ATTEMPTS:
                self._store.clear_state(user_id)
                return FormsOutcome(reply='Сначала выберите номер текущего периода отпуска. Начните заново позже.')
            self._store.bump_attempts(user_id)
            return FormsOutcome(reply='Сначала выберите номер текущего периода отпуска из списка — новая дата будет дальше.')
        start, days = parse_user_dates(content, int(payload.get('year') or datetime.now(UTC).year))
        if start is not None:
            updated = {**payload, 'start': start.isoformat()}
            if days is not None:
                updated['days'] = days
            return self._collect_dates(updated, kind, 0, content, user_id)
        if attempts + 1 >= MAX_PARSE_ATTEMPTS:
            self._store.clear_state(user_id)
            return FormsOutcome(reply='Не понял выбор. Начните заново — напишите про заявление ещё раз.')
        self._store.bump_attempts(user_id)
        return FormsOutcome(reply='Напишите номер периода (1, 2, …) или свою дату, например «с 05.02.2026 на 10 дней».')

    def _period_selected(self, payload: dict, kind: str, user_id: int) -> FormsOutcome:
        """A schedule period was chosen: vacation goes straight to the summary
        confirm (the list choice is already a confirmation), transfer moves
        on to the new dates."""

        start = date.fromisoformat(payload['start'])
        days = int(payload['days'])
        if kind == 'transfer':
            payload = {**payload, 'old_start': payload['start'], 'old_days': days}
            self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:dates', payload=_dump(payload))
            return FormsOutcome(
                reply=(
                    f'Текущий отпуск: {_period_line(start, days)}. '
                    f'На какую дату переносим? Можно указать и количество дней — по умолчанию {days}.'
                )
            )
        return self._to_confirm(payload, kind, user_id)

    def _confirm_period(
        self,
        payload: dict,
        kind: str,
        attempts: int,
        content: str,
        user_id: int,
    ) -> FormsOutcome:
        if has_yes(content):
            return self._to_confirm(payload, kind, user_id)
        if has_no(content):
            # «нет» at the period question means: not these dates — ask for custom
            custom = {'kind': kind, 'year': payload.get('year')}
            if payload.get('position') is not None:
                custom['position'] = payload['position']
            self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:dates', payload=_dump(custom))
            return FormsOutcome(reply=DATE_QUESTION + '.')
        start, days = parse_user_dates(content, int(payload.get('year') or datetime.now(UTC).year))
        if start is not None:
            updated = {**payload, 'start': start.isoformat()}
            if days is not None:
                updated['days'] = days
            return self._collect_dates(updated, kind, 0, content, user_id)
        return FormsOutcome(reply='Ответьте «да» или напишите свою дату, например «с 05.02.2026 на 10 дней».')

    def _collect_dates(
        self,
        payload: dict,
        kind: str,
        attempts: int,
        content: str,
        user_id: int,
    ) -> FormsOutcome:
        default_year = int(payload.get('year') or datetime.now(UTC).year)
        start, days = parse_user_dates(content, default_year)
        if start is None or (kind == 'unpaid' and days is None):
            if attempts + 1 >= MAX_PARSE_ATTEMPTS:
                self._store.clear_state(user_id)
                return FormsOutcome(reply=f'{BAD_DATE_HINT} Начните заново позже.')
            self._store.bump_attempts(user_id)
            return FormsOutcome(reply=BAD_DATE_HINT)
        if days is None:
            # transfer: days default to the old period (D-F-3); a vacation
            # bare date still needs the day count
            if kind == 'transfer' and payload.get('old_days'):
                days = int(payload['old_days'])
            else:
                asked = {**payload, 'start': start.isoformat()}
                self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:dates', payload=_dump(asked))
                return FormsOutcome(reply='На сколько календарных дней?')
        return self._to_confirm({**payload, 'start': start.isoformat(), 'days': days}, kind, user_id)

    def _to_confirm(self, payload: dict, kind: str, user_id: int) -> FormsOutcome:
        payload = dict(payload)
        payload['days'] = int(payload['days'])
        self._store.set_state(user_id, f'{FORM_STATE_PREFIX}{kind}:confirm', payload=_dump(payload))
        person = self._find_stored(user_id)
        spec = FORMS[kind]
        start = date.fromisoformat(payload['start'])
        days = int(payload['days'])
        position = payload.get('position') or (person.position if person else None) or ''
        name = person.full_name if person else ''
        if kind == 'transfer':
            old_start = date.fromisoformat(payload['old_start'])
            old_days = int(payload['old_days'])
            summary = (
                f'{spec.title} — {name}, {position}: '
                f'вместо {_period_line(old_start, old_days)} — '
                f'с {start.strftime(spec.formats["new_start"])} на {days} {calendar_days_word(days)}.'
            )
        else:
            summary = (
                f'{spec.title} — {name}, {position}: '
                f'с {start.strftime(spec.formats["start_date"])} на {days} {calendar_days_word(days)}.'
            )
        return FormsOutcome(reply=f'{summary} Оформить? (да/нет)')

    def _generate(self, payload: dict, kind: str, user_id: int) -> FormsOutcome:
        person = self._find_stored(user_id)
        if person is None:
            question, none_person = self._lookup_person(kind, user_id)
            return self._after_person(kind, question, none_person, user_id)
        spec = FORMS[kind]
        start = date.fromisoformat(payload['start'])
        days = int(payload['days'])
        today = datetime.now(UTC).date()
        values: dict[str, str] = {
            'org_name': self._settings.org_name,
            'addressee': self._settings.addressee_name,
            'position': (payload.get('position') or person.position or '')[:MAX_POSITION_CHARS],
            'full_name': person.full_name,
        }
        if kind == 'transfer':
            old_start = date.fromisoformat(payload['old_start'])
            old_days = int(payload['old_days'])
            values.update(
                old_start=old_start.strftime(spec.formats['old_start']),
                old_days=str(old_days),
                old_days_word=calendar_days_word(old_days),
                new_start=start.strftime(spec.formats['new_start']),
                new_days=str(days),
                new_days_word=calendar_days_word(days),
                year=str(payload.get('year') or old_start.year),
            )
        else:
            values.update(
                days=str(days),
                days_word=calendar_days_word(days),
                start_date=start.strftime(spec.formats['start_date']),
            )
        if spec.has_year_slot:
            values['year'] = str(payload.get('year') or start.year)
        values['today'] = today.strftime(spec.formats['today'])
        body = fill(load_template(spec), values)
        self._store.clear_state(user_id)
        attachment = GeneratedForm(
            filename=attachment_filename(spec, person.full_name),
            content_type=CONTENT_TYPE,
            body=body,
        )
        reply = f'Готово — {spec.title.lower()} оформлено. Файл приложен: скачайте и проверьте перед подписью.'
        return FormsOutcome(reply=reply, attachment=attachment)

    # --- helpers -------------------------------------------------------------------------

    def _find_stored(self, user_id: int) -> VacationPerson | None:
        surname = self._store.get_surname(user_id)
        if surname is None:
            return None
        match = self._service.find(surname)
        return match.person if match.kind == 'found' else None
