# Acceptance criteria — 2026-11-01-chat-leave

Base: `feature/2026-11-01-contacts` @ 25f1868f022566ae2bfdc55d20ab47f7b9e080fa.
Evidence routes: `EV-BE-1` = verify:backend receipts (pytest incl. the
migration segment test + alembic heads); `EV-FE-1` = npm run verify
(logic wave); `EV-FE-2` = npm run verify + guard strict (UI wave).

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-LEAVE` | `REQ-BE-LEAVE` | `EV-BE-1` | Migration 010 adds `chat_members.left_at` (nullable; NULL = active) and is proven by the segment roundtrip test (stamp head -> downgrade one step -> upgrade head, inspector-asserted; alembic heads == 010_chat_leave; the 009 segment test's head-relative '-1' target is pinned to the explicit '008_pg_trgm_search_indexes' revision id in the same wave — rev-3 amendment, without which the suite gate is unachievable once 010 exists); `POST /chats/{id}/leave` sets left_at (member 204, repeat 204 idempotent, never-member 403 chat_membership_required, anonymous 401) and closes the caller's sockets for the chat (user-scoped); `DELETE /chats/{id}/members/{user_id}` is owner-only (owner 204, non-owner 403 chat_owner_required, no-row 404, unknown chat 404) and hard-deletes the row: the kicked user loses the chat (absent from their GET /chats, WS connect refused) and re-add creates a fresh row; the GET /chats LIST carries caller-relative `left_at` (null for active) passed explicitly in the field-by-field construction (the single-chat GET /{id} keeps left_at null by design — no membership context, documented); re-adding a LEFT member reactivates it (left_at -> NULL, active again, requester must be an active member); all pinned by pytest. |
| `AC-BE-WS-ARCHIVE` | `REQ-BE-WS-ARCHIVE` | `EV-BE-1` | Membership guards split by intent, enforced via `ChatService.require_active_member` from the WS send branch, the REST message-create and reaction-toggle endpoints, add_member, leave, the bot-run check (services/bot.py) and the chat-scoped file-upload check (services/files.py): READ paths (GET chat, GET messages, GET members, WS connect incl. initial history and pagination) accept active OR archived rows; WRITE paths reject archived members with 403 (WS send: explicit error, no broadcast) — every rejection pinned; `mark_read` is a NO-OP for archived rows (a 403 would break archived history — the inline history call); the WS hub carries per-socket user identity with a user-scoped close (`close_user_chat`) and an active-membership fan-out filter, pinned by an INTEGRATION-LEVEL TWO-SOCKET test (one active + one archived client in the same chat, the test_stories_ws.py multi-client precedent): the active client receives message/reaction events, the archived one receives nothing; kick and leave close ONLY the affected user's socket; delete-chat stays owner-only by owner_id regardless of the owner's archived state. |
| `AC-FE-LOGIC` | `REQ-FE-LEAVE-LOGIC` | `EV-FE-1` | `ChatsPort.removeUsers` becomes supported (DELETE `/${chatId}/members/${userId}` + csrf per user id) and `leaveChat(chatId)` joins the port (POST + csrf); `toChatInfo` maps `left_at` -> `ChatInfo.leftAt` (absent/null -> undefined) AND `owner_id` -> `ChatInfo.owner_id` (currently dropped — both mappings mocha-pinned); URL shapes + csrf pinned; the controller `removeUsersFromChat` replaces the private deleteChatUsers path AND removes the legacy `user.onClick` instant-kick wiring in getChatUsers (the forEach dies in THIS wave — pinned); `leaveChat` closes the chat socket without reconnect, clears selectedChat and refetches (pinned); `addContact(userId)` and `refreshContacts()` delegate to ONE injected integration object — module-level `setContactsIntegration` in features/chats/controller.ts with noop defaults, wired in features/index.ts beside setChatOpener as the only cross-feature seam (injection + noop defaults pinned). |
| `AC-FE-UI` | `REQ-FE-LEAVE-UI` | `EV-FE-2` | Clicking a header avatar opens a Modal context menu: another user's avatar shows «Добавить в контакты» only when their id is NOT in contactIds and «Удалить из чата» only when meId === ownerId; the viewer's OWN avatar (id === meId) shows «Удалиться из чата»; archived chats show NO menu AND hide the `+` add-user header button; every menu has «Отмена» — the visibility matrix, the archived suppressions and all three actions firing the right callbacks are mocha-pinned (XSS on display_name pinned); ChatPage CDM calls the injected refreshContacts so the conditional contact item works on cold /messenger entry (pinned); leaving clears the selection and the chat card renders dimmed via the archived modifier driven by leftAt (pinned); the composer is hidden for archived chats while history stays scrollable (pinned); menu items render through the escapeHtml builder only. |
| `AC-PROCESS` | `REQ-FE-LEAVE-UI` | `EV-FE-2` | npm run verify, npm run verify:backend (pytest incl. the 010 segment test; heads == 010_chat_leave) and guard strict pass with grown counts (mocha 423 base; pytest 218 base modulo the 4 documented Windows ingestion failures); docs/NEXT.md records the feature and docs/progress/progress_log.md gets an entry on top (carrying the still-open follow-up registry); no file outside the manifest write-sets changes; the run rides feature/2026-11-01-contacts off 25f1868. |

## Details

### AC-BE-LEAVE — two exits, two semantics

Self-leave ARCHIVES (row keeps left_at; history + dimmed list entry
stay; no live pushes; writes 403) — the operator explicitly wants the
chat kept for history. Owner-kick DELETES the row — the kicked user
has no archive view, the chat vanishes for them and re-add starts a
fresh row. Re-add after LEAVE reactivates the SAME row (left_at ->
NULL) — the archive flag clears and live membership resumes; the
re-add actor must be an ACTIVE member.

### AC-BE-WS-ARCHIVE — reads flow, writes stop, pushes filtered

The guard split is enforced at the ENTRY POINTS the write-set owns:
endpoints/chats.py (message create, reaction toggle), ws/router.py
(send), services/chats.py (add_member, leave, mark_read no-op),
services/bot.py and services/files.py (the two remaining membership
write checks — guards only, no behaviour change for active members);
services/messages.py stays untouched (its row-exists _require_member
is the READ side). The hub gains per-socket identity (StoriesHub
precedent), a user-scoped close and an active-membership fan-out
filter; the two-socket integration pin replaces any hedge. Closing
sockets on leave/kick is hygiene; the fan-out filter is the
correctness backstop.

### AC-FE-LOGIC — one seam, consumer-side

The contacts seam lives in features/chats/controller.ts (the
CONSUMER): `setContactsIntegration({addContact, refreshContacts})`
with noop defaults, wired in features/index.ts. A setter in the
contacts feature would force a cross-feature import from chats and
fail the guard (review F-2). `refreshContacts` exists because the
contacts slice is only fetched by the contacts page today — without
it the conditional «Добавить в контакты» runs against an empty slice
on cold /messenger entry (review F-5).

### AC-FE-UI — menu visibility matrix

viewer=owner: other avatar -> [contact-item if not contact] [«Удалить
из чата»]; own avatar -> [«Удалиться из чата»]. viewer≠owner: other
avatar -> [contact-item if not contact]; own avatar -> [«Удалиться из
чата»]. archived chat: no menus, no `+` button. The contacts check is
CLIENT-side against the (now bootstrapped) contacts slice; the owner
check uses ChatInfo.owner_id; meId identifies the own avatar.

### AC-PROCESS — counts and notes

Real bases at the attempt line: mocha 423, pytest 218. The manual
smoke (leave, watch the chat dim, open history, verify no new messages
arrive from a second session; kick; re-add both ways) is an operator
NOTE, not a gate.
