# Developer overview — 2026-11-01-chat-leave

## Intent and user-visible result

Member avatars in the chat header become actionable: a click opens a
context menu. Another member: add them to contacts (only if not there
yet) or — for the chat owner — remove them from the chat. Your own
avatar: «Удалиться из чата» — the chat turns into an archive entry for
you: it stays in the list (dimmed), the history stays readable, but
new messages no longer arrive and the composer is gone. The owner
kicking someone removes the chat from that user entirely.

## Architecture map

Backend (the model -> repository -> service -> endpoint pipeline):

- `models/chat.py` — `ChatMember.left_at` (NULL = active); migration
  `010_chat_leave` + the segment roundtrip test (the 009 pattern —
  never attempt a full-chain SQLite run, 008/005 are PG-only).
- `repositories/chats.py` — active/archived-aware membership queries,
  the broadcast-filter support (active member ids per chat),
  `remove_member` for kicks.
- `services/chats.py` — `kick_member` (require_owned), `leave`
  (idempotent), read/write guard splits, `add_member` reactivation;
  endpoints `DELETE /{chat_id}/members/{user_id}` and
  `POST /{chat_id}/leave` (router order before int routes);
  `list_chats` passes `left_at` explicitly.
- `ws/router.py` + hub — send-guard (archived -> error), broadcast
  fan-out filtered to active members, socket closing on leave/kick.

Frontend (feature-sliced):

- `features/chats` — port grows supported `removeUsers` + `leaveChat`;
  adapter URLs + csrf + `left_at` mapping; controller
  `removeUsersFromChat` / `leaveChat` (close socket, clear selection,
  refetch) / `addContact` via the INJECTED adder.
- `features/chats` (consumer side) — `setContactsIntegration` (noop
  defaults), wired in `features/index.ts` beside `setChatOpener` (the
  only cross-feature seam; pages/components never import sibling
  features).
- UI — Messenger header menus (Modal precedent from the contacts
  page; visibility matrix owner x contact x own-avatar), archived card
  modifier in chatListUser + scss, composer hidden when archived;
  ChatPage maps store -> props (contacts slice, meId, ownerId).

## Key risks

- Router order: `/{chat_id}/members/{user_id}` DELETE is new — verify
  it cannot shadow or be shadowed (the /search, /dm precedents).
- The guard split is enforced at the entry points the write-set owns
  (endpoints/chats.py message+reaction, ws/router.py send,
  services/chats.py, services/bot.py, services/files.py) —
  services/messages.py stays untouched (its row-exists check is the
  READ side; its REST message POST is guarded at the endpoint).
- mark_read must become a NO-OP (not 403) for archived rows — the
  history path calls it inline and a 403 would break archived reads.
- The ChatHub has no per-socket identity today: the wave adds it
  (StoriesHub precedent), a user-scoped close (close_user_chat — the
  whole-chat close would kill other members' sockets on kick/leave)
  and an active-membership fan-out filter; the two-socket integration
  pin (active receives, archived silent) replaces any hedge.
- The contacts seam is CONSUMER-side: setContactsIntegration lives in
  features/chats/controller.ts (a setter in contacts would force a
  cross-feature import and fail the guard); refreshContacts exists
  because the contacts slice is only fetched by the contacts page —
  ChatPage CDM calls it so the conditional menu item works on cold
  /messenger entry.
- ChatInfo.owner_id does not exist yet — wave 2 adds it to the type
  AND to toChatInfo (currently dropped) with a test pin; without it
  the owner-only «Удалить из чата» never renders.
- The legacy header-avatar onClick (instant kick via unsupported
  removeUsers) is removed in wave 2 (controller.ts getChatUsers
  forEach) — wave 3 builds the menu on top; no dead path remains.
- Windows host: verify:backend via `bash backend/verify.sh` with
  PYTHON_BIN; the 4 ingestion failures are pre-existing noise; the
  migration proof is the segment test, not verify.sh.

## Execution model

Three sequential workstreams (backend -> FE logic -> FE UI), one
worker each; verify / verify:backend / guard strict are the quality
floors; the run rides feature/2026-11-01-contacts @ 25f1868 into the
open PR.

## Non-goals reminder

No WS member-list push (refresh on next fetch), no rejoin button
(re-add reactivates), no ownership transfer, no bulk ops, the contacts
page menu stays as built.
