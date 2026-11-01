# Acceptance criteria — 2026-11-01-email-search

Base: `feature/2026-11-01-contacts` @ 90f843095b6af31cd0b5b8c37ca3cb813601241e
(the contacts feature branch; rebase trivially if the PR merges first).
Evidence route: `EV-FE-1` = `npm run verify` + guard strict receipts.

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-FE-EMAIL-SEARCH` | `REQ-FE-EMAIL-SEARCH` | `EV-FE-1` | Neither add-user modal (messenger, contacts page) rewrites the typed value: a query containing `@` reaches `onSearchUsers`/`searchUsers` VERBATIM (`alice@chatty.local` intact — mocha-pinned in both messenger.test.ts and contacts.test.ts, replacing the old @-strip expectations); the input keeps the user's text as typed (no value rewrite); the modal hint says the full email works («начало или полный email»); prefix-only queries (`alice`) still search (pinned); backend untouched (`test_social_api.py:129` remains the full-email prefix pin). |
| `AC-PROCESS` | `REQ-FE-EMAIL-SEARCH` | `EV-FE-1` | `npm run verify` green end-to-end and `guard-architecture.mjs --all --strict` zero violations; `docs/progress/progress_log.md` entry on top; no file outside the manifest write-set changes. |

## Details

### AC-FE-EMAIL-SEARCH — why the fix is frontend-only

The backend prefix search already handles `@`: `search_by_login_prefix`
escapes only `%`/`_`/`\` and the integration suite pins
`login=alice@ex` matching (`backend/tests/integration/chat/test_social_api.py:129`).
The breakage is the legacy `@`-marker strip in the two modal input
handlers — a convention from when a login could not contain `@`; the
own-backend login is the full email, so the strip destroys exactly the
character the user needs. Removing the strip changes no search
semantics: the server still sees a prefix, just an un-mangled one.

### AC-PROCESS — scope discipline

Single workstream, five files (four src/test + progress log); no
backend, no SCSS, no new components. Live smoke (typing the full email
in both modals against the compose stack) is an operator NOTE, not a
gate — jsdom cannot exercise the modal against a real backend.
