# Developer overview — 2026-11-08-vacation-forms

## What you are building

The assistant learns to PRODUCE documents: a user says «оформи заявление
на отпуск» and receives the filled corporate RTF form as a chat
attachment. Everything the bot needs is already in the database from the
parent run (vacation_names — canonical ФИО; vacation_periods — dates,
days, должность col 1 of the xlsx, D-F-2). The new code is deterministic:
a wizard collects only what the schedule cannot answer, an RTF renderer
substitutes ASCII placeholders, and the file rides the EXISTING upload +
message-attachment path.

## Orientation map (read these first)

- backend/app/vacations/ — the parent package: intent.py (extend),
  skill.py (one skip-condition), service.py (expose position),
  store.py (payload), config.py (two env vars), forms/ (NEW: registry,
  rtf renderer, wizard skill), templates/ (NEW: 3 sanitized RTF).
- backend/app/services/bot.py — the hook site: FormsSkill first, then
  VacationSkill, then the normal RAG path; attachment upload + posting.
- backend/app/api/v1/endpoints/bot.py — the ONLY api file touched: it
  constructs FileService with request.app.state storage and passes it in
  (D-F-5; narrow write, ownership-audited).
- backend/app/services/files.py + messages.py — READ ONLY: upload guard
  is active-member (the bot user qualifies — add_member in _execute),
  MessageCreate.file_id is the posting contract, _is_library_file is the
  precedent for bot attachments.
- backend/alembic/versions/015_vacations.py — the down_revision anchor;
  016 adds exactly one column.

## Hard rules

- Real requisites never enter any committed file — not the header values,
  not the originals' `{\info}` author metadata (a third real name + a
  legal-DB vendor marker: the derivation removes the whole `{\info}`
  group and a test pins its absence); templates carry placeholders,
  tests carry fiction; the controller's real-marker grep list lives only
  in local work/ evidence (D-F-10/D-F-16).
- The originals' text is 100% `\uNNNN*` escapes (r7-office, ansicpg0) —
  search requisites as fully-escaped runs, emit VALUES in the same
  profile (D-F-18); never `\'hh`.
- No LLM calls in the forms flow (D-F-6); no new dependencies; no
  frontend writes; src/, app/ws, app/core, app/ingestion, app/bot stay
  untouched; tasks/RAG-docs is read-only.
- The parent skill's observable behavior must not change: its tests are
  the regression net; the shared surname helper is an extraction, not a
  redesign (D-F-13).
- Backend gate: bash backend/verify.sh with the stand venv PYTHON_BIN —
  PASS = all green except exactly the 4 known POSIX-only ingestion
  failures (D-11 of the parent run, unchanged).
