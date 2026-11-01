# Acceptance criteria — 2026-11-01-contacts

Base: `dev` @ 238ec533bd08839f1696d24a7e6bc347f7fb8048. Evidence routes:
`EV-BE-1` = `npm run verify:backend` receipt; `EV-FE-1` = `npm run verify`
receipt (logic wave); `EV-FE-2` = `npm run verify` + guard strict receipts
(UI wave).

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-CONTACTS` | `REQ-BE-CONTACTS` | `EV-BE-1` | `GET /contacts` returns the caller's contacts `{id, login, display_name, avatar_url, created_at}` ordered `created_at DESC, contact_user_id DESC` (id = contact user id; empty list for a fresh user); `POST /contacts {user_id}` is idempotent (201 on create AND on existing; re-add never duplicates a row — composite PK + get-then-insert), rejects self-add with 400 `contact_self_forbidden` and unknown users with 404 `user_not_found`; `DELETE /contacts/{user_id}` returns 204 and a repeat 404 `contact_not_found`; every endpoint answers 401 to anonymous calls; owner isolation — user B never sees user A's contacts; implicit capture — after A adds B to any chat via `POST /chats/{id}/members`, A's list contains B and B's does NOT contain A, and the members endpoint response is unchanged; all pinned by pytest in `backend/tests/integration/contacts/test_contacts_api.py`. |
| `AC-BE-DM` | `REQ-BE-DM` | `EV-BE-1` | `POST /chats/dm {user_id}`: first call 201 with `is_dm: true`, title = target email local part, owner = caller, exactly the two members; a second call for the same pair returns 200 with the SAME chat id; self-add 400 `dm_self_forbidden`; unknown target 404 `user_not_found`; anonymous 401; a plain 2-member group chat is never reused as the DM (test creates a 2-member group first, then asserts a NEW chat id); `GET /chats` responses carry the additive `is_dm` field; pinned by pytest in `backend/tests/integration/chat/test_dm_api.py`. |
| `AC-BE-MIGRATION` | `REQ-BE-CONTACTS`, `REQ-BE-DM` | `EV-BE-1` | `backend/alembic/versions/009_contacts.py` creates `contacts` (composite PK owner_id + contact_user_id, both FK users.id ON DELETE CASCADE, created_at server_default now) and adds `chats.is_dm` (NOT NULL, server_default '0') via batch_alter_table; `alembic heads` prints exactly `009_contacts` (pinned by `npm run verify:backend`, which runs pytest + `alembic heads` only — review F-2); the 009 upgrade AND downgrade paths are proven INSIDE pytest by `backend/tests/integration/test_migration_009_contacts_segment.py`: scratch SQLite file (tmp_path) -> `Base.metadata.create_all` -> `alembic stamp head` -> `downgrade -1` (009's own downgrade produces the faithful 008 state) -> `upgrade head` (re-applies 009 to it), inspector-asserted both ways (contacts table + `chats.is_dm` absent after downgrade, present after upgrade) — review F-8: a full-chain SQLite run is impossible by design (008 `CREATE EXTENSION pg_trgm` and 005 ALTER-based `create_foreign_key` are PG-only), so the full chain stays the compose-PostgreSQL operational path and the gate proves exactly the 009 segment this plan owns; the existing pytest suite stays green with grown counts from the 184 baseline. |
| `AC-FE-LOGIC` | `REQ-FE-CONTACTS-LOGIC` | `EV-FE-1` | The own adapter hits exactly `GET /contacts`, `POST /contacts` (+csrf), `DELETE /contacts/{id}` (+csrf), `GET /users?login=`, `POST /chats/dm` (+csrf) — URL shapes and DTO mapping mocha-pinned incl. the single avatar fallback point (`avatar_url ?? avatarPoolUrl(id)`); the `contacts` store slice follows the in-slice cast idiom with no `utils/Store.ts` edit; the controller fetch writes the slice, add/remove trigger a refetch, `searchUsers` returns `[]` on port error, and `openDm` calls the injected opener with the returned chatId (default noop opener mocha-pinned); `features/index.ts` wires the opener through ChatsController + `Router.go(MESSENGER)` — the only cross-feature seam; no component, page or scss file is touched by this wave; `npm run verify` green. |
| `AC-FE-UI` | `REQ-FE-CONTACTS-UI` | `EV-FE-2` | `/contacts` mounts ContactsPage (route in `main.ts`, protected by the existing allowlist guard with zero guard edits); the «Контакты» bottom-bar icon navigates to `/contacts` and renders active there while «Чаты» stays bound to `/messenger` (mocha-pinned); the sidebar shows the simplified skeleton — header «Контакты» + «Добавить» button on top, the contacts list from the store, BottomBar — without the stories row and the chat search bar; CDM fetches contacts; the «Добавить» modal reuses `renderAddUserModalContent` (badge «уже в контактах» for existing contacts with disabled result buttons; the default «уже в чате» in messenger unchanged — pinned by a `messenger.test.ts` case, review F-6) with the 300 ms debounce and page-owned refocus; the contact menu modal's «Создать» calls `openDm(id)` and closes, «Найти все чаты» renders disabled with a «пока не реализовано» title, «Отмена» closes (mocha-pinned); the card hover cross opens the delete-confirm modal whose «Удалить» calls `removeContact(id)` (mocha-pinned); ContactItem renders user data through double braces only — a `<script>` login renders as text (XSS test); `chatPaneOpen` initializes to `selectedChat != null` (mocha-pinned); SCSS mirrors the chat.scss breakpoints (380px / 280px tablet / single column <768 with the placeholder hidden) — verified by the task review and the manual smoke note, NOT by mocha (review F-5); `npm run verify` green with grown counts from the 337 baseline. |
| `AC-PROCESS` | `REQ-FE-CONTACTS-UI` | `EV-FE-2` | `npm run verify`, `npm run verify:backend` and `node .claude/hooks/scripts/guard-architecture.mjs --all --strict` pass with grown test counts (337 mocha / 184 pytest baseline); `docs/progress/progress_log.md` gets an entry and `docs/NEXT.md` records the feature INCLUDING the explicit not-done note for «Найти все чаты»; no file outside the manifest write-sets changes; the run lives on `feature/2026-11-01-contacts` off dev @ 238ec53. |

## Details

### AC-BE-CONTACTS — one-directional capture on both resolution paths

The implicit capture lives in `ChatService.add_member` on EVERY
successful resolution (review F-4): the fresh-insert path runs
`ContactRepository.upsert(requester_id, user_id)` before the existing
commit, and the existing-membership early return runs it with its own
commit (that read-only path becomes a small write path). The upsert is
get-then-insert (the member idiom), skipped when `user_id ==
requester_id`, and adds no error path of its own — a contact failure
must not break member addition, and a crash between the two writes only
delays capture to the next idempotent add. `ChatService` composes the
REPOSITORY (not ContactService) to avoid a service-to-service cycle.
Contact capture is one-directional by design: the adder gets the
contact; the added user does not.

### AC-BE-MIGRATION — what each gate actually proves

`npm run verify:backend` proves pytest green (including the 009 segment
roundtrip test) + `alembic heads == 009_contacts`; `backend/verify.sh`
itself runs pytest + `alembic heads` only (review F-2). The segment
test is the migration proof (review F-8): a full-chain SQLite run is
impossible because 008 (`CREATE EXTENSION pg_trgm`) and 005
(ALTER-based `create_foreign_key`) are PostgreSQL-only by their own
docstrings — tempting a worker to "fix" 008, which sits in
WS-BE-CONTACTS forbiddenWrites. The test therefore exercises exactly
the 009 segment in both directions: `stamp head` ->
`downgrade -1` (whose own execution produces the faithful 008 state) ->
`upgrade head` (re-applying 009 to that state), with schema assertions
after each step. The full chain keeps its operational proof on the
compose PostgreSQL (docs/deployment/own-backend.md), outside this
gate.

### AC-BE-DM — is_dm, not member counting

A DM is defined solely by `Chat.is_dm = True`; `find_dm` requires both
memberships and never counts members, so a plain 2-member group can
never be promoted implicitly. Title is denormalized at creation (target
email local part) — the chat list renders it as any other title; the
avatar comes from the existing companion rule. Documented edges: the
members endpoint can later grow a DM beyond two members (flag stays,
chat behaves as a group), and two CONCURRENT first `POST /chats/dm`
calls for the same pair can create two DM rows (no pair uniqueness —
accepted study-scale race, review F-7; sequential UI actions make it
practically unreachable).

### AC-FE-LOGIC — self-sufficient feature, one legal seam

`src/features/contacts/` imports nothing from sibling features; the
page-behaviour dependency (open a chat after DM creation) crosses the
boundary exclusively through `setChatOpener` wired in
`src/features/index.ts` — the composition file that is explicitly
allowed to see all features (the `setProfileController` precedent).
The opener does select + members fetch + navigation; ChatPage's CDM
`fetchChats` then refreshes the list and connects the WS.

### AC-FE-UI — modal-shell reuse and the mobile pane

The add-modal and the contact menu reuse the universal `Modal` shell
with owner-built slot HTML (the messenger precedent); only
`renderAddUserModalContent` grows an optional `alreadyBadge` — the
messenger call site passes nothing and its behaviour is bit-identical
(pinned by a `messenger.test.ts` case, review F-6).
`chatPaneOpen` initializing from the live selection changes ANY return
to /messenger with a selected chat on mobile (pane opens instead of the
list) — deliberate (needed for the contacts -> chat navigation),
documented in the plan and mocha-pinned. The responsive breakpoints are
NOT mocha-provable (jsdom has no layout): the SCSS mirror of the
chat.scss ladder (380 / 280 / single column <768) is verified by the
task review plus the manual smoke note (add contact, create DM, delete
contact at 390px / 800px / 1280px widths) — an evidence NOTE, not a
gate (review F-5).
