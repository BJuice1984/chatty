# Plan — 2026-11-01-chat-leave (rev 2)

Chat member context menus and archived membership. Clicking a member
avatar in the chat header (`messenger__chat-users-container`) opens a
context menu instead of the legacy instant-kick (which errors in own
mode anyway: `ChatsPort.removeUsers` is `unsupported`). Another user's
avatar: «Добавить в контакты» (only when they are NOT in the viewer's
contacts) and «Удалить из чата» (only when the viewer owns the chat).
The viewer's OWN avatar: «Удалиться из чата» — the chat becomes an
ARCHIVE entry for them: it stays in the list (dimmed), history remains
readable, but new messages stop arriving (WS), the composer is hidden
and the backend rejects writes. Kicking (owner removing another) is a
hard membership delete: the kicked user loses the chat entirely.

## Operator decisions (2026-11-01)

1. Kick another member — chat OWNER only (backend-enforced; the
   delete-chat precedent).
2. Leave — ANY member including the owner (the chat lives on; owner_id
   stays historical).
3. Archived member — READ-ONLY: history readable, no live WS pushes,
   no writes (403); re-adding the member reactivates membership
   (left_at -> NULL).

## API contract (the wave decoupling point)

1. Migration `010_chat_leave`: `chat_members.left_at` DateTime
   timezone-aware NULLable (NULL = active member); the same segment
   roundtrip test pattern as 009 (scratch SQLite, create_all -> stamp
   head -> downgrade -1 -> upgrade head, inspector-asserted — full
   chain stays the compose-PostgreSQL operational path, 008/005 are
   PG-only).
2. `DELETE /api/v1/chats/{chat_id}/members/{user_id}` — owner-only
   (`chat_owner_required` 403, `chat_not_found` 404,
   `member_not_found` 404 when no membership row exists); hard-deletes
   the row, closes the kicked user's sockets for the chat (user-scoped
   close, NOT the whole-chat close); 204. The kicked user: chat
   disappears from their GET /chats, WS connect is refused (existing
   membership guard), re-add creates a fresh row.
3. `POST /api/v1/chats/{chat_id}/leave` — caller must have a
   membership row; sets `left_at = now` (repeat leave on an archived
   row is an idempotent 204; a never-member gets
   `chat_membership_required` 403); closes the caller's sockets for
   the chat (user-scoped); 204.
4. `GET /chats` (the LIST) grows caller-relative
   `left_at: datetime | null` per row, passed explicitly in the
   field-by-field construction (the is_dm precedent). The single-chat
   `GET /chats/{chat_id}` keeps `left_at: null` (model_validate has no
   membership context — documented; the UI consumes the list data).
5. Membership guards split by intent. READ (GET chat, GET messages,
   GET members, WS connect incl. initial history, history pagination)
   — a membership row suffices (active OR archived). WRITE — ACTIVE
   membership required, enforced via a new
   `ChatService.require_active_member` called from: the WS send branch
   (`ws/router.py`), the REST message create and reaction toggle
   endpoints (`endpoints/chats.py`), `add_member`, `leave` itself, the
   bot-run path (`services/bot.py` require_member -> active variant)
   and the chat-scoped file-upload membership check
   (`services/files.py`). Archived -> 403 `chat_membership_required`
   (WS send: explicit error, no broadcast). `mark_read` becomes a
   NO-OP for archived rows (a 403 would break archived history — the
   history path calls it inline). Delete chat stays owner-only by
   owner_id regardless of the owner's archived state (require_owned
   unchanged).
6. WS hub learns per-socket user identity (the StoriesHub precedent):
   user-scoped close (`close_user_chat(chat_id, user_id)` for
   leave/kick) and a broadcast fan-out that consults ACTIVE membership
   per recipient — archived sockets receive nothing (message,
   reaction, chat_deleted), active sockets still do. Pinned by an
   integration-level TWO-SOCKET test (one active + one archived client
   in the same chat — the multi-client harness precedent from
   test_stories_ws.py): the active client receives the event, the
   archived one does not.
7. `add_member` reactivation: an existing row with `left_at` set
   resets to NULL (idempotent 201 semantics unchanged); implicit
   contact capture (requester -> user) stays on BOTH resolution paths.
   The re-add ACTOR must be an ACTIVE member (the write guard).

## Wave 1 — backend (WS-BE-CHAT-LEAVE)

1. `backend/app/models/chat.py` — `ChatMember.left_at` (DateTime
   timezone-aware, nullable). Migration `010_chat_leave` +
   `backend/tests/integration/test_migration_010_chat_leave_segment.py`
   (the 009 segment pattern). Amendment (rev 3): the 009 segment
   test's `downgrade '-1'` is head-relative and breaks the moment 010
   exists — this wave also pins its downgrade target to the explicit
   `'008_pg_trgm_search_indexes'` revision id (one functional line +
   comment in test_migration_009_contacts_segment.py, now in the
   write-set).
2. `backend/app/repositories/chats.py` — active/archived-aware
   membership queries (`is_member` row-exists stays for READS;
   `is_active_member` for writes; `list_for_user` returns ALL rows
   with `left_at`; active member ids per chat for the fan-out filter);
   `remove_member` (hard delete) for kicks.
3. `backend/app/services/chats.py` — `require_active_member`;
   `kick_member` (require_owned + row check); `leave` (idempotent);
   `mark_read` no-op for archived; `add_member` reactivation; schemas:
   `ChatResponse.left_at: datetime | None = None` additive.
4. `backend/app/api/v1/endpoints/chats.py` — the two new routes
   (safely ordered against int routes); message-create and
   reaction-toggle endpoints call `require_active_member`;
   `list_chats` passes `left_at` explicitly.
5. `backend/app/ws/hub.py` + `backend/app/ws/router.py` — per-socket
   user identity, `close_user_chat`, active-membership fan-out filter,
   WS send guard for archived members.
6. `backend/app/services/bot.py` + `backend/app/services/files.py` —
   the two remaining membership write checks switch to the ACTIVE
   variant (guards only; no behaviour change for active members).
7. pytest — `backend/tests/integration/chat/test_leave_api.py`: leave
   204 + stays in GET /chats with left_at + repeat 204 + never-member
   403 + anonymous 401; archived WS send rejected + archived REST
   message POST 403 + archived reaction 403 + archived bot-run 403 +
   archived file-upload 403; archived reads pass (GET chat/messages/
   members + WS initial history); mark_read no-op for archived;
   kick owner 204 / non-owner 403 / no-row 404 / kicked loses the chat
   (list + WS connect refused); re-add after kick = fresh row; re-add
   after leave reactivates; left_at null for active in the list; the
   TWO-SOCKET fan-out pin (active receives, archived silent; kick and
   leave close only the affected user's socket).

## Wave 2 — frontend logic (WS-FE-CHAT-LEAVE-LOGIC)

1. `src/utils/types.ts` — `ChatInfo.leftAt?: string | null` AND
   `ChatInfo.owner_id?: number` (the owner-only menu item needs it).
2. `src/features/chats/ports.ts` — `removeUsers` becomes supported
   (DELETE `/${chatId}/members/${userId}` per user), `leaveChat`
   additive.
3. `src/features/chats/api/own.ts` — both calls + csrf; `toChatInfo`
   maps `left_at` -> `leftAt` (absent/null -> undefined) AND
   `owner_id` -> `owner_id` (currently dropped at own.ts:103-121);
   api.test.ts: URL shapes, csrf, both mappings.
4. `src/features/chats/controller.ts` — `removeUsersFromChat`
   (replaces the private `deleteChatUsers` path AND removes the legacy
   `user.onClick` instant-kick wiring in `getChatUsers` — the forEach
   at controller.ts:332-334 dies here, pinned); `leaveChat` (port ->
   closeChat WITHOUT reconnect -> clear selectedChat -> refetch);
   `addContact(userId)` + `refreshContacts()` delegating to ONE
   injected integration object: module-level
   `setContactsIntegration({addContact, refreshContacts})` with noop
   defaults (the seam lives in the CONSUMER feature — the setChatOpener
   lesson; a setter in contacts would force a cross-feature import).
5. `src/features/index.ts` — wires
   `setContactsIntegration({ addContact: userId =>
   contactsController.addContact(userId), refreshContacts: () =>
   contactsController.fetchContacts() })` beside the existing opener —
   the ONLY cross-feature seam. chats.test.ts: injection, noop
   defaults, leave/kick flows, legacy-wiring-gone pin.

## Wave 3 — frontend UI (WS-FE-CHAT-LEAVE-UI)

1. `src/components/messenger/` — header avatar clicks open a Modal
   context menu (escapeHtml builder): another user -> [«Добавить в
   контакты» only when the id is NOT in contactIds] [«Удалить из
   чата» only when meId === ownerId]; own avatar (id === meId) ->
   [«Удалиться из чата»]; archived chats show NO menu and hide the
   `+` add-user header button (messenger.hbs/messenger.ts:468-473
   wiring); every menu has «Отмена». New props: contactIds, meId,
   ownerId, onAddContact, onKickUser, onLeaveChat. messenger.test.ts:
   visibility matrix, actions, the archived button/menu suppression,
   XSS on display_name.
2. `src/features/chats/pages/chat/` — CDM additionally calls
   `ChatsController.refreshContacts()` (the injected refresh populates
   the slice on cold /messenger entry — without it the conditional
   contact item sees an empty slice); withStore mapper supplies
   contactIds (contacts cast idiom), meId, ownerId; callbacks wired to
   the controller; chat.test.ts pins.
3. `src/components/chatListUser/` + `src/scss/components/chat-list-user.scss`
   — archived modifier driven by leftAt (dimmed card; no comments in
   scss); test pin.
4. Composer hidden for archived chats (messenger.hbs conditional;
   history stays scrollable); test pin.
5. Docs — `docs/NEXT.md` record + `docs/progress/progress_log.md`
   entry on top (incl. the open follow-up registry: the «@-поиск»
   comment sweep from 2026-11-01-email-search).

## Wave 4 — evidence and closure

`npm run verify`, `verify:backend`, guard strict; evidence receipts
under `work/2026-11-01-chat-leave/evidence/`; the feature rides the
`feature/2026-11-01-contacts` line (base 25f1868) into the open PR.

## Out of scope

WS push of member-list changes (menus/avatars refresh on next fetch);
a rejoin button (re-add reactivates); ownership transfer when the
owner leaves; muting distinctions; DM member growth (documented edge);
deleting the chat on leave; bulk operations; the contacts page menu
(stays as built); the single-chat GET /chats/{id} left_at (stays null
by design — the list is the source).
