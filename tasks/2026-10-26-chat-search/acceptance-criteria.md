# Acceptance criteria — 2026-10-26-chat-search

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-LAST-MESSAGE` | `REQ-BE-LAST-MESSAGE` | `EV-BE-1` | `GET /chats` returns `last_message: {content: str \| None, time} \| null` on every chat, fetched for the whole list as ONE SELECT statement (pinned by a `before_cursor_execute` statement-count guard, the `test_unread_counts.py` precedent) with the `(created_at DESC, id DESC)` newest-wins tie-break pinned by a unit test; file-only messages carry `content: null`, message-less chats carry `last_message: null`; `POST /chats` and `GET /chats/{id}` keep returning `last_message: null` (the `None` default keeps their `model_validate` path alive — regression-pinned); the server-side list ORDER BY is unchanged; `alembic heads` output unchanged; pytest covers all of the above in integration + unit tests. |
| `AC-BE-SEARCH` | `REQ-BE-SEARCH` | `EV-BE-1` | `GET /chats/search?q=` matches a case-insensitive substring over the caller's member-chat titles and non-null message contents using `lower() + LIKE` (PostgreSQL-correct full-Unicode folding at runtime) with `%`/`_`/`\` escaped (the `repositories/users.py` rule); returns `{query, results: [{chat_id, matched_in: 'title'\|'message'\|'both', snippet: {before, match, after} \| None, last_match_at \| None}]}` where the snippet is the raw-substring window (≤32 before, ≤32 after) around the FIRST occurrence in the FRESHEST matching message; ordering is title-group first (title ASC, chat_id ASC) then message-only by `last_match_at` DESC, chat_id DESC, capped at 50 after ordering; foreign chats never appear (membership isolation pinned); `q` of 0 or >200 chars fails validation; anonymous gets 401; case-insensitivity test samples are ASCII-only (the in-memory SQLite test env folds ASCII only; Cyrillic folding is PG-runtime behaviour, not test-asserted); pytest covers every branch. |
| `AC-FE-LOGIC` | `REQ-FE-SEARCH-LOGIC` | `EV-FE-1` | `toChatInfo` maps `last_message` into `ChatInfo.last_message` with the single `'Вложение'` placeholder for `content === null` and `undefined` for absent; `ChatsPort.searchChats(query)` hits `GET /chats/search`; the `chatSearch` Store slice lives behind an in-slice cast following the `chats/history/store.ts` idiom (no `utils/Store.ts` edit); `controller.searchChats` trims, resets without a request on empty, drops stale answers via a monotonic sequence counter (a slow earlier response never overwrites a later one — mocha-pinned) and fails silently; the WS `message` handler patches `last_message` next to `incrementUnread` reading the RAW `OwnMessageResponse` payload (the mapped `toMessage` collapses file-only `null` to `''` — the placeholder would be lost), so an incoming message lifts the chat, and the author's own send lifts it through the SAME mechanism (the server broadcasts every created message to all sockets of the chat, author included — `backend/app/ws/router.py:87`); no send-path patch exists (mocha-pinned). |
| `AC-FE-UI` | `REQ-FE-SEARCH-UI` | `EV-FE-2` | The SearchBar fires `onSearch` debounced at `CHAT_SEARCH_DEBOUNCE_MS = 300` (sinon fake timers: silent at 299 ms, firing at 300 ms, timer cleared in `destroy()`), the submit handler is gone, and the typed value survives page re-renders — the module-static `lastTypedValue` (updated on every input event, seeding each instantiation's `value`; the debounce gates only the controller call) preserves uncommitted text through a Store-driven re-render mid-typing, with page-owned focus/caret restore (mocha-pinned); with an empty query the page renders ALL chats ordered by `Date.parse(last_message.time)` DESC, chats without `last_message` below, tie-break id DESC (mocha-pinned); with an active query only matching chats render, in the server result order (mocha-pinned); the card highlights the matched fragment with `<mark>` in the title (title/both matches) and/or renders the marked message snippet under the title (message matches), with the time column showing `last_match_at` during a search and `last_message.time` otherwise; every highlight piece is escape-then-wrap rendered — a `<script>` payload in content or title renders as text (XSS test), triple braces appear ONLY for the pre-escaped highlight HTML. |
| `AC-PROCESS` | `REQ-BE-LAST-MESSAGE`, `REQ-BE-SEARCH`, `REQ-FE-SEARCH-LOGIC`, `REQ-FE-SEARCH-UI` | `EV-FE-2` | `npm run verify` and `npm run verify:backend` pass with grown test counts (337 mocha / 184 pytest baseline), `guard-architecture.mjs --all --strict` reports zero violations; `docs/progress/progress_log.md` gets an entry and `docs/NEXT.md` records the feature (with the FTS deferral note); no file outside the manifest write-sets changes. |

## Details

### AC-BE-LAST-MESSAGE — one batched statement, newest wins

The claim pinned by the guard is one SELECT for the whole list, in the
spirit of (not identical to) the `unread_counts` single-query contract.
A window function (`row_number() over (partition by chat_id order by
created_at desc, id desc)`) is the direct form and is supported by both
SQLite (tests) and PostgreSQL (runtime); any single-statement
equivalent is acceptable if the tie-break stays `(created_at, id)`.
The assembly of `ChatLastMessageBrief` belongs to one place (service
helper) so `list_chats` cannot drift from a future consumer.

### AC-BE-SEARCH — raw parts, client-side escaping

The server returns raw `before/match/after` substrings of the original
content — it never pre-escapes. This keeps the endpoint
transport-only and makes the client's escape-then-wrap rendering the
single XSS-controlling seam (one seam, tested at that seam). `both`
merges a title match with the freshest message match; title-only rows
carry `snippet: null, last_match_at: null` — the client then
highlights only the title and keeps the plain last-message snippet
line.

### AC-FE-LOGIC — the two Store patches that make the list live

`incrementUnread` proved the pattern: the WS `message` handler already
maps `state.chats`; the `last_message` patch slots beside it and the
page's derived sort turns it into "chat rises to the top" with zero
extra events. The own server broadcasts every created message to all
sockets of the chat, the author's included
(`backend/app/ws/router.py:87`, confirmed in plan review) — the WS
patch alone lifts incoming and own-sent messages; no send-path patch
exists.

### AC-FE-UI — the re-render trap and the one-line invariant

Every Store write re-instantiates the hbs children: the typed text
lives in the bar's module-static `lastTypedValue` (updated on every
input event, seeding each instantiation), and focus/caret restore is
page-owned (chat.ts componentDidUpdate -> rAF) — re-created hbs
children get neither CDM nor CDU. The
snippet line keeps the existing one-line ellipsis invariant under the
title (a dedicated `__snippet` class replaces the currently duplicated
`__title` h4). `mark` styling follows the existing palette; no new
design tokens.

### AC-PROCESS — gates and bookkeeping

`EV-BE-1` is the `npm run verify:backend` output; `EV-FE-1` is
`npm run verify` plus the guard run. A manual smoke against the
compose stack (typing in the bar, watching a chat rise on an incoming
message from a second session) is an evidence NOTE, not a gate.
