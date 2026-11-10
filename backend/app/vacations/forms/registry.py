"""The form registry: the three vacation applications and their templates.

Templates live in ``backend/app/vacations/templates/`` (sanitized: the
real header requisites are placeholders filled from the operator env,
the originals' ``{\\info}`` metadata group is stripped — D-F-1/D-F-10).
Every template's token set must equal the registry declaration exactly
(pinned by tests/unit/vacations/test_forms_registry.py, including a
golden decode of each template body).

Date slots are template-specific (D-F-18/F-R1-7): where the form prints
its own year («с ___ 2026 г.») the date token carries DD.MM and the year
rides in a separate {{year}} slot; where it does not (the unpaid form,
the transfer's new period, the vacation signature date) the token
carries the full DD.MM.YYYY.

The author's name is printed twice and declines differently: the header
block after «от» takes {{full_name_gen}} (родительный: «Сибгатуллина
И.Р.»), the signature расшифровка keeps {{full_name}} (именительный).
Both are filled by the wizard from one person record (declension.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / 'templates'

DAY_MONTH = '%d.%m'
FULL_DATE = '%d.%m.%Y'


def calendar_days_word(count: int) -> str:
    """The full agreed phrase: 1 «календарный день», 2 «календарных дня»,
    5/14 «календарных дней» (F-R1-3/D-F-9; the chat helper days_word in
    service.py answers a different question and stays untouched)."""

    if count % 10 == 1 and count % 100 != 11:
        return 'календарный день'
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return 'календарных дня'
    return 'календарных дней'


@dataclass(frozen=True)
class FormSpec:
    id: str
    title: str
    template_name: str
    filename_title: str
    tokens: tuple[str, ...]
    # token -> strftime format for every date-carrying slot
    date_formats: tuple[tuple[str, str], ...]
    # True when the template carries a {{year}} slot (filled from the
    # schedule snapshot year, D-F-8)
    has_year_slot: bool

    @property
    def template_path(self) -> Path:
        return TEMPLATES_DIR / self.template_name

    @property
    def formats(self) -> dict[str, str]:
        return dict(self.date_formats)


_VACATION_TOKENS = (
    'org_name', 'addressee', 'position', 'full_name', 'full_name_gen',
    'days', 'days_word', 'start_date', 'year', 'today',
)
_TRANSFER_TOKENS = (
    'org_name', 'addressee', 'position', 'full_name', 'full_name_gen',
    'old_start', 'old_days', 'old_days_word',
    'new_start', 'new_days', 'new_days_word',
    'year', 'today',
)
_UNPAID_TOKENS = (
    'org_name', 'addressee', 'position', 'full_name', 'full_name_gen',
    'days', 'days_word', 'start_date', 'today',
)

FORMS: dict[str, FormSpec] = {
    'vacation': FormSpec(
        id='vacation',
        title='Заявление на отпуск',
        template_name='vacation_application.rtf',
        filename_title='Заявление на отпуск',
        tokens=_VACATION_TOKENS,
        date_formats=(
            ('start_date', DAY_MONTH),
            ('today', FULL_DATE),
        ),
        has_year_slot=True,
    ),
    'transfer': FormSpec(
        id='transfer',
        title='Заявление о переносе отпуска',
        template_name='vacation_transfer.rtf',
        filename_title='Заявление о переносе отпуска',
        tokens=_TRANSFER_TOKENS,
        date_formats=(
            ('old_start', DAY_MONTH),
            ('new_start', FULL_DATE),
            ('today', DAY_MONTH),
        ),
        has_year_slot=True,
    ),
    'unpaid': FormSpec(
        id='unpaid',
        title='Заявление на отпуск за свой счёт',
        template_name='unpaid_vacation.rtf',
        filename_title='Заявление на отпуск за свой счёт',
        tokens=_UNPAID_TOKENS,
        date_formats=(
            ('start_date', FULL_DATE),
            ('today', FULL_DATE),
        ),
        has_year_slot=False,
    ),
}


def load_template(spec: FormSpec) -> bytes:
    return spec.template_path.read_bytes()


def attachment_filename(spec: FormSpec, full_name: str) -> str:
    """«Заявление на отпуск — Абрикосов Т.П..rtf» (own chat-scoped file)."""

    return f'{spec.filename_title} — {full_name}.rtf'
