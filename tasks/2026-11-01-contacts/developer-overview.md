# Developer overview — 2026-11-01-contacts

## Intent and user-visible result

The bottom-bar «Контакты» icon (today a `console.log` no-op in
`src/components/bottomBar/bottomBar.ts:18`) becomes a real route. At
`/contacts` the messenger sidebar swaps its chat list for a contacts
list: header «Контакты» with a «Добавить» button on top, cards (avatar,
name, login, hover delete cross), bottom bar. «Добавить» opens the same
debounced email-prefix search modal used when adding users to a chat;
users already in the contact list are badged «уже в контактах». Clicking
a contact opens a small modal menu: «Создать» opens (or creates) the
1:1 chat with that contact and navigates to it in the messenger;
«Найти все чаты» is a visible but disabled stub. Contacts accumulate
implicitly — every user the owner adds to any chat becomes their
contact — and explicitly through «Добавить».

## Architecture map

Backend (the model -> repository -> service -> endpoint pipeline):

- `models/contact.py` — `Contact(owner_id, contact_user_id)` composite
  PK, CASCADE both sides; `models/chat.py` — `Chat.is_dm`.
- `repositories/contacts.py` — get/upsert/remove/list_for_owner;
  `repositories/chats.py` — `find_dm(a, b)` (is_dm + both memberships).
- `services/contacts.py` — guards + response assembly (`UserSearchItem`
  naming rule); `services/chats.py` — `create_dm` + implicit capture in
  `add_member` on both success paths (in-transaction on the fresh
  insert, own commit on the idempotent early return;
  `ContactRepository` used directly to avoid a service->service cycle).
- `endpoints/contacts.py` registers through the `register_domain` seam
  (`endpoints/__init__.py`, the users.py stage-16 precedent);
  `POST /chats/dm` joins `endpoints/chats.py` BEFORE `/{chat_id}`.
- Migration `009_contacts` (table + `chats.is_dm`, batch_alter for
  SQLite); `alembic heads` moves 008 -> 009.

Frontend (feature-sliced, ports/adapters):

- New self-sufficient module `src/features/contacts/` (ports, api/own +
  index, store slice with the chatSearch cast idiom, controller
  singleton, module.ts). Features never import each other — the page
  receives cross-feature behaviour through `setChatOpener` wired in
  `src/features/index.ts` (the `setProfileController` precedent):
  select chat + fetch members + `Router.go(MESSENGER)`.
- Route registration in `src/main.ts`; `/contacts` is protected by the
  existing allowlist guard (`features/auth/guard.ts` PUBLIC_PATHS) — no
  guard edits.
- UI: `components/contactItem/` card; `components/messenger/messenger.ts`
  `renderAddUserModalContent` gains an optional `alreadyBadge`
  (default keeps messenger behaviour); ContactsPage owns modal state in
  props and root-delegated events (the Messenger precedent); ChatPage
  initializes `chatPaneOpen` from the live selection.
- SCSS: `contacts.scss` + `contact-item.scss` mirror the chat.scss
  breakpoint ladder (380 / 280 / single column).

## Key risks

- Route order in FastAPI: `/chats/dm` after `/{chat_id}` would 422 on
  the literal — same class of bug as `/search` (pinned by test).
- Implicit capture runs in `add_member` on BOTH success paths (fresh
  insert + the existing-membership early return, which commits on its
  own — review F-4); a contact failure must not break member addition
  (upsert is get-then-insert, no IntegrityError path in the happy flow).
- `createDm` returns the chat id ONLY: `HTTPTransport` resolves
  `xhr.response` and discards the success status
  (`src/utils/HTTPTransport.ts:124-126`), so a `created` flag is
  unimplementable within the write-sets (review F-1).
- `npm run verify:backend` proves pytest (incl. the 009 segment
  roundtrip test) + `alembic heads` ONLY; a full-chain SQLite migration
  run is impossible by design (008 `CREATE EXTENSION pg_trgm`, 005
  ALTER-based FK — PG-only), so the migration proof is the pytest
  segment test and the full chain stays the compose-PostgreSQL
  operational path (reviews F-2/F-8). Never "fix" 008 to make a
  full-chain run pass — it is in WS-BE-CONTACTS forbiddenWrites.
- Concurrent first `POST /chats/dm` calls for one pair can create two
  DM rows — accepted study-scale race, no pair uniqueness (review F-7).
- `chatPaneOpen` initial-value change alters ANY return to /messenger
  with a live selection on mobile (pane opens instead of list) —
  deliberate, documented, mocha-pinned; watch review feedback.
- Modal slot HTML is unescaped by design: only the escapeHtml builder
  may build it (XSS test on contact card + modal results).
- Windows host: `npm run verify:backend` needs the direct
  `bash backend/verify.sh` form (docs/NEXT.md); the 4 ingestion
  subprocess failures are pre-existing environment noise, not gates.

## Execution model

Three sequential workstreams (backend -> frontend logic -> frontend
UI), one worker each, `maxParallelTasks: 1`; `npm run verify` /
`verify:backend` / guard strict are the per-wave quality floors and the
evidence commands; branch `feature/2026-11-01-contacts` off dev @
238ec53. Frontend logic consumes only the wave-1 API contract, so the
two frontend waves can start right after backend acceptance.

## Non-goals reminder

«Найти все чаты» stays a disabled stub and MUST be recorded as not-done
in docs/NEXT.md (the implementation lives on another machine, not yet
merged); contacts are one-directional; no WS push; no pagination.
