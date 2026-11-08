# Specification — 2026-11-08-vacation-forms (S2)

## Intent

Operator request of 2026-11-08: the assistant fills the three corporate
vacation application RTF forms («Заявление о переносе отпуска.RTF»,
«заявление на отпуск.RTF», «заявление на отпуск свой счет.RTF» from
tasks/RAG-docs/) — collects the missing fields in a chat dialog,
autofills the rest from the ingested 2026 schedule (фамилия from
vacation_names, периоды and должность from vacation_periods), renders the
RTF and delivers the ready file as a chat attachment. Three operator
clarifications: sanitized placeholder templates live in the repo with the
real requisites (org name, addressee) supplied from environment config
(D-F-1); должность autofills from the schedule's first column (D-F-2,
operator correction — the parser already stores it); vacation dates
autofill from the schedule with confirmation, custom dates are typed in
the dialog (D-F-3). The run executes autonomously under the operator
mandate «делай автономно» (D-F-0); the live smoke stays a deferred
operator gate exactly like the parent run (EV-4, final audit BLOCKED,
PR held).

## User-visible behavior

Three entry intents, all deterministic (keywords matched as exact word
forms at word boundaries — no prefix/stem matching; unpaid triggers are
corroborated compound phrases, a bare «счёт» never triggers; D-F-19):

- «оформи заявление на отпуск» / «мне нужно заявление на отпуск» → the
  `vacation` wizard («Как оформить отпуск?» WITHOUT a заявление keyword
  stays the parent's `vacation` — pinned);
- «хочу перенести отпуск» / «заявление о переносе отпуска» → `transfer`;
- «нужен отпуск за свой счёт» / «отпуск без сохранения зарплаты» /
  «без содержания» → `unpaid`.

### Common pre-steps

1. Requisites check: if CHATTY_VACATION_ORG_NAME or
   CHATTY_VACATION_ADDRESSEE_NAME is unset the bot refuses to start with
   a pointer to docs/deployment/vacation-forms.md; no dialog state.
2. Surname: the user's stored canonical name must resolve in the latest
   snapshot; if missing/stale the wizard asks for the surname FIRST
   (same UX as the parent skill: token-exact matching, ambiguity list
   «ФИО (подразделение)», difflib hints, 2 attempts, cancel words exit
   without burning an attempt; the canonical name is persisted on
   success — D-F-13 shared helper).

### vacation wizard (заявление на отпуск)

- One schedule period → «В графике: с 21.12.2026 на 7 дней. Оформить
  заявление с этими датами? (да / напишите свою дату)».
- Several periods → numbered list + «напишите свою дату, если не подходит
  ни одна»; a numeric answer picks the period.
- Custom dates → «С какой даты и на сколько дней? Например:
  с 05.02.2026 на 14 дней» (deterministic parser: dd.mm.yyyy / dd.mm —
  year from the schedule snapshot; days 1..365; two malformed attempts
  end the wizard politely).
- Summary → «Заявление на отпуск — Абрикосов Т.П., финансовый менеджер:
  с 05.02.2026 на 14 календарных дней. Оформить? (да/нет)».
- да → RTF rendered, uploaded, posted as an attachment with the reply
  «Готово — файл приложен»; нет/отмена → cancelled, state cleared.

### transfer wizard (заявление о переносе отпуска)

Old period from the schedule (same choice/confirm step), then «На какую
дату переносим? Можно указать и количество дней — по умолчанию
{old_days}», then the summary confirm. The rendered form carries both
the old (график) and the new period plus the ст. 124 ТК РФ basis line
already printed in the template.

### unpaid wizard (заявление на отпуск за свой счёт)

Dates are always asked (not in the schedule): start + календарных дней
(required); summary confirm; the ст. 128 ТК РФ basis line stays in the
template.

### Shared dialog rules

Cancel words exit any step with a brief ack; TTL 600 s (existing store)
— an expired state behaves as absent; an unrelated non-form message
resets the wizard and takes the normal path; starting a wizard clears
any pending parent-skill state (D-F-12); a form intent of a DIFFERENT
kind during an active wizard restarts the wizard with the new kind
(payload cleared), the same kind re-states the current step (D-F-19);
the parent vacation offer never fires for form intents («Хочу в отпуск»
keeps offering dates — pinned by the existing tests, unchanged).

## Generated document

- Sanitized RTF templates (derived from the operator files) live in
  backend/app/vacations/templates/: vacation_application.rtf,
  vacation_transfer.rtf, unpaid_vacation.rtf. The originals are
  r7-office RTF ({\rtf1\ansi\ansicpg0}) where EVERY character — Cyrillic
  AND digits/dots/spaces/underscores — is a `\uNNNN*` escape (decimal \u
  + the `*` fallback byte; zero \'hh bytes; D-F-18, verified by byte
  inspection). Derivation: requisites searched as fully-escaped runs and
  replaced with ASCII tokens; the `{\info}` metadata group REMOVED
  entirely (its author carries real names/vendor data — D-F-10); the
  date/year slot cluster «\_\_.\_\_ 202\_\_ г.» collapses to
  «{{start_date}} {{year}} г.»; underscore runs (`\u95*` clusters,
  possibly split by format groups) mapped positionally; подпись keeps
  its underscores.
- ASCII tokens (per-form subsets per the registry): {{org_name}}
  {{addressee}} {{position}} {{full_name}} {{today}} {{year}}
  {{start_date}} {{days}} {{days_word}} {{old_start}} {{old_days}}
  {{old_days_word}} {{new_start}} {{new_days}} {{new_days_word}}.
  Formats declared by FormSpec: {{start_date}}/{{old_start}}/{{new_start}}
  = DD.MM (the year rides in the separate {{year}} slot — a full date
  would duplicate it), {{today}} = DD.MM.YYYY; {{days_word}} = the full
  agreed phrase from calendar_days_word (D-F-9: «календарный день» /
  «календарных дня» / «календарных дней»).
- Renderer: byte-level token replacement in the RTF source; values
  RTF-escaped to the SAME `\uNNNN*` profile (literal safe ASCII
  passthrough, `\ { }` escaped, everything else → decimal \uNNNN* —
  interpretation independent of the reader's code page; D-F-18/F-R1-1);
  pre-fill validation (mapping keys == template tokens), post-fill check
  (no `{{` remains).
- Filename: «Заявление на отпуск — Абрикосов Т.П..rtf» /
  «Заявление о переносе отпуска — ….rtf» / «Заявление на отпуск за свой
  счёт — ….rtf»; content type application/rtf; chat-scoped file row
  owned by the bot user, posted via MessageCreate(file_id=…)
  (run.attachment_file_id), rendered by the existing UI.

## Data and config

- Migration 016_vacation_forms: ALTER assistant_dialog_state ADD COLUMN
  payload Text NULL (batch_alter; downgrade drops it). Nothing else —
  должность/периоды already live in vacation_periods (D-F-2).
- VacationPerson gains `position` (first non-null row value) —
  VacationService.find exposes the already-stored column.
- VacationStore state accessors carry payload (set_state/get_state,
  backward compatible).
- vacations/config.py: CHATTY_VACATION_ORG_NAME ('' default),
  CHATTY_VACATION_ADDRESSEE_NAME ('' default) + .env.example entries;
  empty ⇒ wizards refuse with the runbook pointer.

## Privacy and security

- Real requisites never enter the repo (D-F-10): the header values, the
  third real name inside the originals' {\info} author metadata and the
  legal-DB vendor marker are stripped/absent; sanitized templates +
  fictional test fixtures (ООО «Альфа-Тех», Смирнову А.А.); the
  controller's real-marker grep list lives ONLY in local work/ evidence
  (privacy-markers.md); the filled REAL forms of EV-3 stay in work/
  evidence only.
- Own forms only: the wizard fills documents solely for the user's own
  stored canonical name; no third-party generation path exists.
- Generated files ride the existing chat-scoped guards (participant-only
  download, active-member upload); the frontend is untouched.

## Non-goals

- «Заявление работника на увольнение» and every other HR form (D-F-15);
  the classifier must NOT match them into form intents.
- Full-name expansion (ФИО полностью) beyond the canonical schedule form
  (D-F-7); LLM phrasing of wizard texts (D-F-6); template editing UI;
  PDF conversion; e-signature; filing/sending the form anywhere;
  frontend changes; vacation_names.position column (cancelled by D-F-2).

## Acceptance summary

AC-TEMPLATES (sanitized templates + registry + privacy pins incl. the
{\info} strip), AC-RTF (renderer pins: \uNNNN* escapes, formats,
validation), AC-DATA (migration 016 roundtrip + position exposure +
payload store), AC-INTENT2 (form intents before vacation/schedule;
увольнение and stem/billing false positives excluded), AC-WIZARD (dialog
scenarios for all three forms through the bot), AC-DELIVER (attachment
posted via FakeStorage; storage-unavailable graceful failure),
AC-RUNBOOK2 (operator doc matches shipped flags), AC-PROCESS2
(gates/journal/commits), AC-REALFORMS (controller-local real-file
control opened in Word), AC-LIVE2 (deferred operator smoke EV-4 —
blocks final audit and the PR). Full statements: acceptance-criteria.md.
