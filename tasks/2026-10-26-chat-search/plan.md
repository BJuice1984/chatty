# Plan — 2026-10-26-chat-search

Live chat-list search and activity ordering. `GET /chats` grows an
additive `last_message {content, time}`; a new `GET /chats/search`
matches a case-insensitive substring over the caller's chat titles and
message contents and returns per-chat match metadata (matched_in,
snippet `{before, match, after}`, last_match_at) in a title-first
order; the frontend turns the decorative SearchBar into a debounced
live input, sorts the list by last message time when the query is
empty (hiding nothing) and shows only matching chats in the server
order while searching, highlights the matched fragment with `<mark>`
in the title and/or the message snippet, and lifts a chat to the top
when a message arrives or is sent.

## API contract (the decoupling point for the waves)

1. `ChatResponse.last_message: ChatLastMessageBrief | None = None`;
   `ChatLastMessageBrief {content: str | None, time: datetime}`.
   The `None` default is load-bearing (`POST /chats`, `GET /chats/{id}`
   build via `model_validate` over the ORM object — without the default
   both 500). `content is None` means a file-only message; no messages
   at all -> `last_message: null`. One batched SELECT for the whole
   list, `(created_at DESC, id DESC)` tie-break, statement-count-guard
   pinned. The server-side list ORDER BY does NOT change.
2. `GET /api/v1/chats/search?q=` (q: 1..200 chars, cap
   `CHATS_SEARCH_RESULTS_CAP = 50`) over the caller's member chats:
   `lower(title) LIKE '%q%'` and `lower(content) LIKE '%q%'`
   (`content IS NOT NULL`), `%`/`_`/`\` escaped like
   `repositories/users.py`. **Portability note (review F-1):** keep
   `lower() + LIKE` — correct for the PostgreSQL runtime, where `lower()`
   folds full Unicode (Cyrillic included). The test environment is
   in-memory SQLite (`tests/conftest.py`), whose `lower()` folds ASCII
   ONLY — so case-insensitivity test samples must be ASCII (e.g.
   `Chat`/`chat`); Cyrillic case-folding is PG-runtime behaviour and is
   NOT asserted by tests. Response
   `{query, results: [{chat_id, matched_in: 'title'|'message'|'both',
   snippet: {before, match, after} | None, last_match_at | None}]}`:
   snippet = window around the FIRST case-insensitive occurrence in
   the FRESHEST matching message, `before`/`after` ≤ 32 chars each,
   parts are RAW substrings (the client escapes). Order: title-group
   (title-only + both; title ASC, chat_id ASC) then message-only
   (`last_match_at` DESC, chat_id DESC); cap after ordering. Membership
   scoping by construction — foreign chats never appear.

## Wave 1 — backend (WS-BE-CHAT-SEARCH)

1. `backend/app/schemas/chat.py` — `ChatLastMessageBrief`,
   `ChatResponse.last_message` (None default, guarantee comment),
   `ChatSearchResult`, `ChatsSearchResponse`.
2. `backend/app/repositories/chats.py` —
   `last_messages_for_chats(chat_ids)` (one SELECT, window or
   equivalent, SQLite-compatible) and the search row queries
   (title-matching chats; matching messages with their chats) — the
   service assembles.
3. `backend/app/services/chats.py` — `last_messages_for_chats` passthrough/
   assembly (file-only -> content None), `search_chats(user_id, q)`
   (membership scope, snippet builder around the first occurrence with
   the 32/32 window, matched_in merge, ordering, cap).
4. `backend/app/api/v1/endpoints/chats.py` — attach `last_message` in
   `list_chats`; new `search_chats` endpoint (`/search`, BEFORE the
   `/{chat_id}` routes so the path does not shadow — mind the router
   order).
5. pytest: integration `backend/tests/integration/chat/
   test_chat_search.py` (title match, message match, both, multi-chat
   ordering, case-insensitivity, `%`/`_` escaping, file-only content
   never matches, foreign-chat isolation, cap 50, empty q -> 422,
   401 anonymous); `last_message` assertions in the existing GET /chats
   integration test (newest wins the tie-break, file-only content
   null, empty chat null, POST/GET /{id} null default); unit
   `backend/tests/unit/chat/test_last_messages.py` with the
   statement-count guard and the `(created_at, id)` tie-break.

No migration; `alembic heads` output must not change.

## Wave 2 — frontend logic (WS-FE-CHAT-SEARCH)

1. `src/utils/types.ts` — `ChatSearchMatch` (UI type; no api import).
2. `src/features/chats/ports.ts` — `searchChats(query: string)` (pure
   port contract addition).
3. `src/features/chats/api/own.ts` — `OwnChatResponse.last_message?`
   DTO; `toChatInfo` maps it (`content === null` -> `'Вложение'`,
   absent -> `undefined`); `searchChats` via `http.get('/chats/search',
   {q})`; api.test.ts cases (placeholder, passthrough, absent,
   URL-shape).
4. `src/features/chats/store.ts` — `chatSearch` slice
   (`setSearch(query, results)`, `resetSearch()`, typed getter with the
   in-slice cast following the `chats/history/store.ts` idiom
   (`ChatHistoryStoreState = AppState & {…}` + cast) — `state.stories`
   IS declared in AppState, so history is the true no-Store.ts-edit
   precedent).
5. `src/features/chats/controller.ts` — `searchChats(query)`: trim,
   empty -> reset (no request), else port call guarded by a monotonic
   sequence counter (stale answers dropped); errors logged silently.
6. `src/features/chats/ws/own.ts` — in the `message` handler, next to
   `incrementUnread`: patch `chats[chat_id].last_message =
   {content: content ?? 'Вложение', time: created_at}` reading the RAW
   `OwnMessageResponse` payload (the mapped `toMessage` collapses
   file-only `null` to `''` at `ws/own.ts:101`, which would defeat the
   placeholder). The own server broadcasts every created message to ALL
   sockets of the chat INCLUDING the author's (`backend/app/ws/router.py:87`,
   confirmed by plan review) — the WS patch alone lifts both incoming
   and own-sent messages; no send-path patch is needed.
7. `src/features/chats/chats.test.ts` — controller search cases (trim,
   reset, stale-answer drop, silent failure), WS last_message patch
   (incoming; the author's own send rides the same broadcast).

## Wave 3 — frontend UI (WS-FE-CHAT-SEARCH-UI)

1. `src/utils/highlight.ts` — `buildHighlightParts(haystack, needle)`
   (`{before, match, after} | null`, case-insensitive first occurrence,
   empty needle -> null) and `renderHighlighted(parts)` (escape every
   part, wrap only the match in `<mark>`); unit tests including the
   `<script>` XSS case.
2. `src/components/searchBar/` — debounced `input` flow
   (`CHAT_SEARCH_DEBOUNCE_MS = 300` exported, instance timer cleared in
   `destroy()`), `onSearch` prop, submit handler removed. **Typed-value
   memory (review F-2):** the debounce gates ONLY the controller call;
   the typed text must never depend on it — the bar keeps a
   module-static `lastTypedValue` (the `usersScroll`/`scrollMemory`
   precedent: `chat.ts:353-354`, `messenger.ts:178`) updated on EVERY
   input event, and every instantiation seeds `value` from it, so a
   page re-render triggered by any Store emit (an incoming WS message
   mid-typing) recreates the input with the CURRENT text, not the last
   debounced snapshot. **Value channel (review F-4):** `searchBar.hbs`
   renders its own raw `<input value="{{value}}">` (double-braced —
   Handlebars escapes it; `src/components/input/**` stays untouched).
   searchBar tests with sinon fake timers: no call at 299 ms, call at
   300 ms, empty input resets, timer cleared on destroy, and a
   Store-driven re-instantiation mid-typing preserves the uncommitted
   text.
3. `src/components/chatListUser/` — `titleParts`/`snippetParts` props,
   title renders highlighted parts when present; snippet line under the
   title (dedicated `__snippet` class with the existing one-line
   ellipsis); right-column time = `last_match_at` while searching else
   `last_message.time`; tests (mark in title, mark in snippet, plain
   last message without a query, XSS-escaped parts).
4. `src/features/chats/pages/chat/chat.ts` + `chat.hbs` — the page
   renders the SearchBar with `value` seeded from the bar's own static
   memory (no page query prop needed for the text itself); withStore
   mapper derives the ordered list: active query -> chats of
   `chatSearch.results` in server order; else all chats by
   `Date.parse(last_message.time)` DESC, no-last_message chats below,
   tie-break id DESC — always a new array reference; pass
   titleParts/snippetParts per card (`buildHighlightParts` on the title
   for title/both matches, the result snippet for message matches);
   time prop switch. **Focus/caret restore (review F-3):** hbs children
   get neither CDM nor CDU on parent re-render, so the restore is
   PAGE-owned: `componentDidUpdate` -> rAF ->
   `querySelector('input[name=chat_search]')`.focus() +
   `setSelectionRange(caret)` when the bar's static focus memory says
   the input was focused (alongside the existing `restoreUsersScroll`
   machinery; the bar records focus/caret in its static memory on
   blur/input). chat.test.ts cases (empty-query ordering, missing
   last_message sinks, search order + hiding, focus+text preserved
   across a Store-driven re-render).
5. `src/scss/components/chat-list-user.scss` (+ `search-bar.scss` if
   needed) — `<mark>` styling consistent with the existing palette,
   snippet ellipsis line.
6. Docs closure: `docs/NEXT.md` — ADD a feature record with the FTS
   deferral note (there is no search item to retire: current NEXT
   priorities are RAG-embeddings only — review F-7),
   `docs/progress/progress_log.md` entry on top.

## Wave 4 — evidence and closure

Three gates green (`npm run verify`, `npm run verify:backend`,
`guard-architecture --all --strict`), evidence receipts under
`work/2026-10-26-chat-search/evidence/`, PR `feature/2026-10-26-chat-search`
-> `dev` after the final audit.

## Out of scope

FTS/pg_trgm indexes and relevance scoring; searching attachment names;
highlighting every occurrence; search pagination beyond the 50 cap;
server-side GET /chats reordering; chat-list pagination; searching
non-member chats; query persistence across sessions; WS push of search
updates; the ai-assistant chats DTO copy (backward compatible,
untouched).
