# Plan — 2026-10-25-chats-list-members

Kill the chat-list avatar N+1: `fetchChats` currently issues one
`GET /chats/{id}/members` per avatar-less chat just to learn the lone
companion (`applyCompanionAvatar` in `src/features/chats/controller.ts`).
Members move into the `GET /chats` response; the controller stops
per-chat member requests and the avatar of a dialog becomes the
companion's REAL avatar (pool stays the fallback) computed once in the
adapter mapper. Avatar changes patch the Store point-wise instead of
refetching the whole list.

## API contract (the decoupling point for the two waves)

`ChatResponse` gains `members: list[ChatMemberBrief]` with
`Field(default_factory=list)` — **the default is load-bearing**: `POST
/chats` and `GET /chats/{id}` build the response via
`ChatResponse.model_validate(chat)` from the ORM object, which has no
`members` attribute; without the default both endpoints would 500.
`ChatMemberBrief` is `{id, login, display_name, avatar_url}` — the exact
shape of `GET /chats/{id}/members` (`login` is the email handle,
`display_name` its local part, `avatar_url` the files-relative
`"{file_id}/download"` or `None`). Both endpoints assemble briefs through
one shared helper so the two forms cannot drift.

Member briefs are capped at `MEMBERS_BRIEF_CAP = 10` per chat, ordered
`joined_at ASC, user_id ASC` (deterministic tie-break). Dialogs (≤ 2
members) are never truncated — the companion rule only needs dialogs.
The batch is one `ChatMember.chat_id IN (...)` query over all listed
chats, grouped in Python (the `stories.list_feed` batch pattern): the
list endpoint issues **zero per-chat member requests**. The
`unread_counts` query shape is untouched — consolidating it into a
single statement is separate debt, explicitly out of scope here.

`GET /chats/{id}/members` KEEPS its current semantics: the full,
uncapped member list ordered `user_id ASC`. The cap and the
`joined_at` ordering apply only to the GET /chats briefs (the member
panel needs every member; silently truncating it after the 10th would
be a regression). Both endpoints assemble briefs through the one
shared `to_member_brief` helper — only the shape is shared, not the
grouping.

Guarantee note (schema comment): `members` is only guaranteed to be
populated by `GET /chats`; `POST /chats` and `GET /chats/{id}` return
the empty default.

## Wave 1 — backend (WS-BE-LIST-MEMBERS)

1. `backend/app/schemas/chat.py` — `ChatMemberBrief` + `members` with
   `default_factory=list` and the guarantee comment.
2. `backend/app/repositories/chats.py` — `list_members_for_chats(
   chat_ids) -> list[tuple[chat_id, user_id, email, avatar_file_id]]`,
   one IN-query ordered by `(chat_id, joined_at, user_id)` (the shape of
   `list_members` widened to many chats).
3. `backend/app/services/chats.py` — `members_for_chats(chat_ids)` →
   `dict[int, list[ChatMemberBrief]]` with the cap; shared
   `to_member_brief(user_id, email, avatar_file_id)` reusing
   `avatar_url()` from `app/schemas/file.py`; `list_chat_members` is
   refactored onto the same helper (wire format unchanged).
4. `backend/app/api/v1/endpoints/chats.py` — `list_chats` attaches the
   batched members.
5. pytest (`backend/tests/integration/chat/test_media_api.py`):
   extend `test_chat_avatar_owner_only_and_chat_list` with
   members assertions; new dialog case "user avatar flows into GET /chats
   members" (owner with an uploaded avatar, member without); cap case
   (12 members → 10, `joined_at` order); additive `POST /chats` →
   `members: []` and `GET /chats/{id}` non-500 assertions (the
   default-field regression) in
   `backend/tests/integration/chat/test_http_and_ws.py`. A
   `/chats/{id}/members` assertion pins the uncapped full list (all 12
   members for the cap-fixture chat, `user_id ASC`).

No migration: tables are untouched, `alembic heads` output must not
change.

## Wave 2 — frontend adapter (WS-FE-CHATS-LIST-MEMBERS)

1. `src/features/chats/ports.ts` — `fetchChats(meId?: number)`, an
   additive optional parameter (test stubs stay compatible). The adapter
   never reads the Store (the api layer does not touch global state).
2. `src/features/chats/api/own.ts` — `OwnChatResponse.members?`; pure
   `toChatInfo(response, meId)` with the avatar ladder
   `chat.avatar_url` → companion real `avatar_url` →
   `avatarPoolUrl(companion.id)` → `''`; "lone non-me member" rule
   (group chats stay `''`); `meId === undefined` or missing `members` →
   no companion computation. `fetchChats` forwards `meId`.
3. `api/api.test.ts` — existing `toChatInfo` cases gain the second
   argument; new mapper cases (real avatar, pool fallback, group chat,
   chat-avatar priority, `meId` undefined, missing members).

Rendering needs no changes: `ChatAvatar` already resolves
files-relative paths through `fileUrl` and treats leading-`/` values as
static assets (`src/components/avatar/chatAvatar/chatAvatar.ts`).

## Wave 3 — controller (same workstream, strictly after Wave 2)

1. `controller.ts` `fetchChats` — drop the N+1 block, pass
   `meId = store.getState().user?.id` to `port.fetchChats(meId)`;
   call sites (including `main.ts` and the chat page CDM) are unchanged
   because meId is computed inside the controller.
2. Delete `applyCompanionAvatar` and its call from `getChatUsers` (the
   member panel keeps its own slice).
3. `changeChatAvatar` — point-wise Store patch: the port already returns
   `{avatar}` from the upload response; the controller reads the chat id
   from the SAME FormData `chatId` field the adapter reads (the clicked
   tile's chat, not necessarily `selectedChat` — string to number),
   maps that single chat's `avatar` in `chatsSlice.setChats(...)` and
   does NOT refetch the list (operator requirement 2026-10-25: one
   avatar change must not re-request everything). The port contract
   stays `Promise<{avatar: string}>` — no chatId added to the return.
4. Purge stale comments (adapter header, `toChatInfo`, test comments)
   claiming "GET /chats carries no members".
5. `chats.test.ts` — all three avatar cases go: 108–121 (lone companion
   pool avatar via getChatUsers), 123–145 (enrich right after
   fetchChats — becomes the N+1 regression: `getChatUsers` spy stays
   uncalled during `fetchChats`), 147–169 (group chats untouched —
   vacuously green after the change, deleted); new case:
   `changeChatAvatar` patches one chat (chatId from the FormData) and
   does not call `fetchChats`.

## Wave 4 — evidence and closure

Three gates green (`npm run verify`, `npm run verify:backend`,
`guard-architecture --all --strict`), evidence receipts under
`work/2026-10-25-chats-list-members/evidence/`, PR to `dev`,
`docs/NEXT.md` priority 1 retired, progress-log entry on top.

## Out of scope

WS push for avatar changes; filling `members` in `POST /chats` and
`GET /chats/{id}` beyond the empty default; pagination of the chat
list; consolidating the `unread_counts` query (it keeps its current
shape — 3 statements plus a per-chat count for chats with read
markers; a separate NEXT debt item); the ai-assistant copy of the
chats DTO (backward compatible, untouched); the `mark_viewed` race
tail (separate NEXT item).
