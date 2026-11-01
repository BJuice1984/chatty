# Plan — 2026-11-01-contacts

User contacts: a persistent, one-directional address book with a dedicated
`/contacts` route. The own backend stores contacts in a new `contacts`
table; the existing add-user-to-chat flow captures contacts implicitly; the
route replaces the chat list with a contacts list (simplified sidebar:
header + «Добавить» + list + bottom bar) reusing the debounced user-search
modal; clicking a contact offers a menu — «Создать» (get-or-create DM via
`POST /chats/dm`, then navigate to the open chat) and «Найти все чаты»
(disabled stub, documented not-done); a hover cross removes a contact after
a confirmation modal.

## API contract (the decoupling point for the waves)

1. `GET /api/v1/contacts` -> `200 [{id, login, display_name,
   avatar_url: str | null, created_at}]`, ordered `created_at DESC,
   contact_user_id DESC`; `id` is the CONTACT USER's id; `login` is the
   lower-cased full email, `display_name` its local part (the
   `UserSearchItem.from_user` rule). Anonymous -> 401.
2. `POST /api/v1/contacts` `{user_id}` -> idempotent `201 ContactResponse`
   (existing row returned with 201 — the `add_member` precedent);
   `user_id == caller` -> 400 `contact_self_forbidden`; unknown user ->
   404 `user_not_found`.
3. `DELETE /api/v1/contacts/{user_id}` -> `204`; absent row -> 404
   `contact_not_found`.
4. `POST /api/v1/chats/dm` `{user_id}` (registered BEFORE `/{chat_id}`
   routes — the `/search` precedent): existing DM -> `200 ChatResponse`;
   none -> creates `Chat(title = target email local part, owner = caller,
   is_ai = False, is_dm = True)` + members caller & target -> `201
   ChatResponse`; self -> 400 `dm_self_forbidden`; unknown target -> 404
   `user_not_found`. `ChatResponse` gains additive `is_dm: bool = False`.
   A DM is defined ONLY by `is_dm = True` — plain 2-member groups are
   never reused.
5. `POST /chats/{chat_id}/members` (EXISTING endpoint, no contract
   change): on every successful resolution — fresh insert or the
   idempotent early return for an existing membership — it also records
   the contact `requester -> added user` (skipped for self-add) — the
   implicit capture path.
6. Migration `009_contacts`: `contacts(owner_id, contact_user_id)` composite
   PK, both `FK users.id ON DELETE CASCADE`, `created_at` server_default
   now; `chats.is_dm` boolean NOT NULL server_default '0' via
   batch_alter_table (SQLite-runnable). `alembic heads` -> `009_contacts`.
   Gate honesty (review F-2/F-8): `backend/verify.sh` runs pytest +
   `alembic heads` only, and a FULL migration chain run on SQLite is
   impossible by design — 008 executes `CREATE EXTENSION pg_trgm` and
   005 uses ALTER-based `create_foreign_key`, both PG-only (their own
   docstrings say so); the full chain is exercised operationally on the
   compose PostgreSQL (docs/deployment/own-backend.md), not by this
   gate. What this gate proves is the 009 SEGMENT in both directions,
   inside pytest (EV-BE-1): new
   `backend/tests/integration/test_migration_009_contacts_segment.py` —
   scratch SQLite file, `Base.metadata.create_all` (current models),
   `alembic stamp head`, `downgrade -1` (009's own downgrade produces
   the faithful 008 state: no contacts table, chats without is_dm),
   `upgrade head` (re-applies 009 to that state), schema asserted by
   inspector after each step (contacts/is_dm absent after downgrade,
   present after upgrade), scratch file deleted. The alembic command
   API runs against the scratch URL through the real
   `CHATTY_DATABASE_URL` override (`app/core/config.py` env_prefix +
   `alembic/env.py`); the worker verifies the exact wiring against
   env.py.

## Wave 1 — backend (WS-BE-CONTACTS)

1. `backend/app/models/contact.py` — `Contact` model; register in
   `models/__init__.py`. `backend/app/models/chat.py` — `Chat.is_dm`.
2. `backend/alembic/versions/009_contacts.py` — table + column, clean
   downgrade (both directions proven by the pytest segment roundtrip in
   item 7, not by verify.sh alone).
3. `backend/app/repositories/contacts.py` — `get`, `upsert`
   (get-then-insert, the `add_member` idiom), `remove`, `list_for_owner`
   (JOIN users, `created_at DESC, contact_user_id DESC`).
   `backend/app/repositories/chats.py` — `find_dm(a, b)` (is_dm + both
   membership IN-subqueries, id asc, limit 1).
4. `backend/app/schemas/contact.py` — `ContactCreate`, `ContactResponse`
   (+ `from_parts` assembly or service-side construction mirroring
   `to_member_brief`). `backend/app/schemas/chat.py` — `ChatDmCreate`,
   `ChatResponse.is_dm`.
5. `backend/app/services/contacts.py` — `list_for_owner`, `add` (guards),
   `remove` (guard). `backend/app/services/chats.py` — `create_dm`
   (find-or-create), and `add_member` records the implicit contact on
   EVERY successful resolution (review F-4): the fresh-insert path before
   its existing commit AND the existing-membership early return (which
   becomes a small write path with its own commit); skipped for self-add;
   idempotent upsert, so a crash between the two writes only delays
   capture to the next add.
6. `backend/app/api/v1/endpoints/contacts.py` — the three routes,
   `register_domain()`; called from `endpoints/__init__.py` (the stage-17
   composition comment style). `endpoints/chats.py` — `POST /dm` before
   `/{chat_id}`; `list_chats` passes `is_dm=chat.is_dm` explicitly in its
   field-by-field `ChatResponse` construction (review F-3 — the single
   `GET /chats/{id}` and `POST /chats` paths fill it via
   `model_validate` automatically).
7. pytest — `backend/tests/integration/contacts/test_contacts_api.py`:
   empty list, add + appears, idempotent re-add (201, single row), self
   400, unknown 404, delete 204 + repeat 404, anonymous 401, owner
   isolation (B never sees A's contacts), implicit capture (A adds B to a
   chat -> A's list contains B, B's does not contain A). New
   `backend/tests/integration/chat/test_dm_api.py`: create 201 (is_dm,
   title = local part, both members), repeat 200 same id, self 400,
   unknown 404, anonymous 401, 2-member group non-collision (a group with
   exactly 2 members exists -> POST /chats/dm still creates a new DM),
   `GET /chats` carries `is_dm`. New
   `backend/tests/integration/test_migration_009_contacts_segment.py`:
   the 009 segment roundtrip of the API-contract item 6 (stamp head ->
   downgrade -1 -> upgrade head on a scratch SQLite file with inspector
   assertions both ways).

## Wave 2 — frontend logic (WS-FE-CONTACTS-LOGIC)

1. `src/utils/types.ts` — `ContactInfo {id, login, display_name, avatar}`.
   `src/utils/constants.ts` — `CONTACTS = '/contacts'`.
2. `src/features/contacts/ports.ts` — `ContactsPort` + locally declared
   `ContactSearchResult`, `DmChatResult` (features never import each
   other). `createDm` resolves `{chatId: number}` ONLY (review F-1):
   `HTTPTransport` surfaces the success status to nobody — it resolves
   `xhr.response` alone (`src/utils/HTTPTransport.ts:124-126`), so a
   `created: 201-vs-200` flag is unimplementable without touching a
   file outside the write-sets and nothing consumes it; the contract is
   the chat id.
3. `src/features/contacts/api/own.ts` — `/contacts` GET/POST/DELETE with
   `readCsrfToken()`, `GET /users?login=` via its own transport,
   `POST /chats/dm` with csrf mapping the response to `{chatId: id}`;
   avatar
   resolved `avatar_url ?? avatarPoolUrl(id)` at the single mapping point;
   `api/index.ts` -> `contactsPort`. `api/api.test.ts` — URL shapes,
   DTO mapping, avatar fallback, csrf on mutations.
4. `src/features/contacts/store.ts` — `contacts` slice, in-slice cast
   (`ContactStoreState = AppState & {contacts?: ContactInfo[]}`), no
   `utils/Store.ts` edit.
5. `src/features/contacts/controller.ts` — singleton
   `ContactsFeatureController` (fetch/add/remove/searchUsers/openDm, the
   ChatsFeatureController error-logging style) + module-level
   `setChatOpener` (default noop). `contacts.test.ts` — port-stubbed
   flows incl. openDm -> opener receives chatId, add/remove refetch,
   searchUsers error -> [].
6. `src/features/contacts/module.ts` — `{name: 'contacts', deps:
   ['auth']}`. `src/features/index.ts` — module registered +
   `setChatOpener((chatId) => { ChatsController.selectChat(chatId); void
   ChatsController.getChatUsers(chatId); Router.go(MESSENGER) })`.

## Wave 3 — frontend UI (WS-FE-CONTACTS-UI)

1. `src/components/contactItem/` — Block + hbs card (avatar, title,
   subtitle, hover delete cross), `onClick`/`onDelete` props, double
   braces only; XSS test (`<script>` login renders as text); registered
   in `components/components.ts`.
2. `src/components/bottomBar/bottomBar.ts` (+ test) — «Контакты» icon:
   `Router.go(CONTACTS)`, active on `/contacts`; «Чаты» unchanged.
3. `src/components/messenger/messenger.ts` — `renderAddUserModalContent`
   gains optional `alreadyBadge?: string` (default `'уже в чате'`);
   messenger behaviour bit-identical, the default badge pinned by a
   `messenger.test.ts` case (review F-6).
4. `src/features/contacts/pages/contacts/` — page + hbs: withStore
   contacts slice; CDM `fetchContacts`; simplified sidebar (header
   «Контакты» + «Добавить», list, BottomBar) + right placeholder; modal
   state in props; add-modal reuses `renderAddUserModalContent` with
   `alreadyBadge: 'уже в контактах'` and `memberIds` = contact ids;
   debounce reuses exported `USER_SEARCH_DEBOUNCE_MS`, root-delegated
   input/click events, page-owned refocus (the messenger wiring pattern);
   contact menu Modal («Создать» -> `openDm` + close; «Найти все чаты»
   disabled with title «пока не реализовано»; «Отмена»); delete-confirm
   Modal -> `removeContact`. Tests: render from store, debounce->search,
   badge on existing contact, menu actions, delete flow, XSS.
5. `src/features/chats/pages/chat/chat.ts` (+ chat.test.ts pin) —
   `chatPaneOpen` initial = `selectedChat != null` (arriving from
   /contacts opens the pane on mobile; documented behaviour change).
6. `src/main.ts` — `Routes.Contacts` + `Router.use(Routes.Contacts,
   ContactsPage)`; `/contacts` protected by the existing allowlist guard.
7. SCSS — `src/scss/components/contacts.scss` (grid `min-content 1fr`,
   380px sidebar with border-right and own-scroll list, placeholder
   pane) + `contact-item.scss`; imported in `_all.scss`; tablet
   768–1023 -> 280px sidebar with the chat.scss paddings; mobile <768 ->
   single column, placeholder hidden, no pane switching. Responsive
   checklist noted in evidence (not a gate).
8. Docs — `docs/NEXT.md` feature record WITH the explicit not-done note
   for «Найти все чаты» (pending the search implementation merge from
   the other machine); `docs/progress/progress_log.md` entry on top.

## Wave 4 — evidence and closure

Three gates green (`npm run verify`, `npm run verify:backend` — the
latter now includes the 009 segment roundtrip test —
`guard-architecture --all --strict`), evidence receipts under
`work/2026-11-01-contacts/evidence/`, PR `feature/2026-11-01-contacts`
-> `dev` after the final audit.

## Out of scope

Implementing «Найти все чаты»; symmetric contacts; WS push of contact
changes; contact import/export/editing/favorites; pagination of GET
/contacts; DM member-count enforcement; chat-list features on contact
cards; deleting a contact deleting the DM; pair-uniqueness for
concurrent `POST /chats/dm` — two simultaneous first calls can create
two DM rows (accepted study-scale race; sequential UI actions make it
practically unreachable, review F-7).
