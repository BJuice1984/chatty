# Developer overview — 2026-10-26-chat-search

Three workstreams in one dependency chain: WS-BE-CHAT-SEARCH
(FastAPI + SQLAlchemy + pytest) ships the two contract additions,
WS-FE-CHAT-SEARCH (TypeScript ports/adapter/Store/controller + the WS
patch) consumes them, WS-FE-CHAT-SEARCH-UI (Handlebars/SCSS/mocha)
makes the list live. Base: `dev` @ 503f455.

## User-visible result

The chat list shows the last message as a one-line snippet under the
title and orders itself by latest activity (newest first), rising when a
message arrives or is sent. Typing in the search bar (300 ms debounce)
resorts the list to only the chats whose TITLE or MESSAGES contain the
query, with the matched fragment highlighted (`<mark>`) in the title or
in the snippet line. Clearing the box restores the activity order.

## Backend map

- `GET /chats` today assembles `ChatResponse` field-by-field in
  `endpoints/chats.py::list_chats` (unread dict + members dict already
  batched) — `last_message` joins exactly there, the same shape of
  merge. Repository: one SELECT for the newest message per chat with the
  `(created_at DESC, id DESC)` tie-break — a `row_number() OVER
  (PARTITION BY chat_id)` window or an equivalent single statement; the
  composite index `ix_messages_chat_created_id (chat_id, created_at,
  id)` already backs it. Pin the single-statement contract with the
  `before_cursor_execute` counter (the `tests/unit/chat/
  test_unread_counts.py:72-84` precedent).
- `ChatResponse.last_message` default `None` is load-bearing: `POST
  /chats` and `GET /chats/{id}` build via `model_validate(chat)` over
  the ORM object — without the default both 500 (the `members`
  default_factory precedent).
- New `GET /chats/search?q=`: membership-scoped (`join ChatMember`),
  `lower() LIKE '%…%'` with escaping `%`/`_`/`\` exactly like
  `repositories/users.py:21-44`. NOTE (review F-1): keep `lower()+LIKE`
  — correct for the PostgreSQL runtime (full-Unicode folding, Cyrillic
  included); the in-memory SQLite test env folds ASCII ONLY, so
  case-insensitivity test samples must be ASCII; Cyrillic folding is
  PG-runtime behaviour, not test-asserted. Snippet = window around the
  first case-insensitive occurrence in the freshest matching message;
  parts are raw substrings — the server does NOT pre-escape (the client
  owns escaping; keeping raw keeps the server transport-only). Cap
  50 after the title-first ordering. Route order matters: register
  `/search` BEFORE `GET /{chat_id}` (FastAPI matches registration
  order; an int path param would 422 on the literal `search`).
- Backend tests: integration in `backend/tests/integration/chat/`
  (new `test_chat_search.py` fits the module layout), repo unit with
  the statement-count guard beside `test_unread_counts.py`.

## Frontend map

- Adapter (`features/chats/api/own.ts`): `OwnChatResponse.last_message`
  DTO + `toChatInfo` mapping (file-only `content: null` -> `'Вложение'`
  placeholder — the single point that knows about it); `searchChats`
  over `HTTPTransport` GET with the `q` query param (URL-encoded
  transport already handles it).
- Store slice (`features/chats/store.ts`): `chatSearch` key in the
  loosely-typed `AppState` — follow the `chats/history/store.ts` idiom
  (`ChatHistoryStoreState = AppState & {…}` + in-slice cast; NOT the
  stories slice — `state.stories` IS declared in AppState). NO
  `utils/Store.ts` edit: a features->utils type import is a guard
  blocker.
- Controller: `searchChats(query)` with a monotonic sequence counter —
  debounce shrinks the race window but two in-flight answers can still
  arrive out of order; the stale one must not win. Reset path writes no
  request.
- Live lift (`features/chats/ws/own.ts`): the `message` handler already
  patches `state.chats` (`incrementUnread`); the `last_message` patch
  slots in next to it, reading the RAW `OwnMessageResponse` payload
  (the mapped `toMessage` collapses file-only `null` to `''` at
  `ws/own.ts:101` and would defeat the `'Вложение'` placeholder). The
  own server broadcasts every created message to ALL sockets of the
  chat including the author's (`backend/app/ws/router.py:87`,
  confirmed by plan review) — the WS patch alone lifts incoming AND
  own-sent messages.
- UI: `SearchBar` currently handles only `submit` and logs to console —
  replace with the debounced `input` flow. CRITICAL UX trap (review
  F-2): every Store emit re-renders the page and re-instantiates hbs
  children, and the WS traffic can land MID-TYPING — the debounce must
  gate ONLY the controller call, never the visible text. The bar keeps
  a module-static `lastTypedValue` (the `usersScroll`/`scrollMemory`
  precedent) updated on every input event; each instantiation seeds
  `value` from it (a raw double-braced `<input value="{{value}}">` in
  `searchBar.hbs` — `src/components/input/**` stays untouched, review
  F-4). Focus/caret restore is PAGE-owned (review F-3): hbs children
  get neither CDM nor CDU on a parent re-render, so `chat.ts`
  `componentDidUpdate` -> rAF -> `querySelector('input[name=chat_search]')
  .focus()` + `setSelectionRange(caret)` driven by the bar's static
  focus memory, alongside the existing `restoreUsersScroll`.
- Derived list: the page's `withStore` mapper computes the ordered
  array (query -> results order; else last-message DESC, id DESC) —
  always a NEW array reference, `shallowEqual` on the `chats` key then
  re-renders on every patch (WS patch, search answer, reset). The
  module-static scroll-restore in `chat.ts:353-391` keeps the list
  scroll position across re-renders.
- Highlighting: `src/utils/highlight.ts` — pure `buildHighlightParts`
  + `renderHighlighted` (escape-then-wrap; the modal `{{{content}}}`
  slot and its XSS test are the precedent). Triple braces in
  `chatListUser.hbs` ONLY for the pre-escaped title/snippet HTML.

## Risks

- XSS via message content/title/query echo into `<mark>` rendering —
  mitigated by escape-then-wrap + a dedicated mocha test asserting
  `&lt;script&gt;` (the response `query` echo never reaches HTML: the
  FE type excludes it).
- Input focus/value loss on re-render (hbs children re-instantiated,
  possibly mid-typing on WS traffic) — mitigated by the module-static
  `lastTypedValue` + page-owned focus restore; covered by a re-render
  mid-typing test.
- SQLite (tests) vs PostgreSQL (runtime) `lower()` divergence — ASCII
  test samples only; Cyrillic folding is a PG-runtime property.
- Stale search answer overwriting a newer one — sequence counter in the
  controller, covered by a mocha test with a slow first stub.
- LIKE scan cost on large corpora — accepted for study scale, deferred
  FTS noted in non-goals.

## Execution model

One worker per workstream, sequential (maxParallelTasks 1): BE -> FE
logic -> FE UI. Evidence per task: `npm run verify:backend` (BE),
`npm run verify` + guard strict (FE waves). Branch:
`feature/2026-10-26-chat-search` off `dev` @ 503f455, PR to `dev` after
the final audit. Docs closure (NEXT.md, progress log) rides the last
wave.
