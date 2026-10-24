# Acceptance criteria — 2026-10-25-chats-list-members

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-MEMBERS` | `REQ-BE-MEMBERS` | `EV-BE-1` | `GET /chats` returns `members` (`[{id, login, display_name, avatar_url}]`, the exact `GET /chats/{id}/members` shape, assembled by one shared helper) on every chat, batched as a single `IN` query over all listed chats — **zero per-chat member requests** from the list endpoint (the `unread_counts` query shape is untouched; consolidating it is out of scope); briefs are capped at 10 per chat by `joined_at ASC, user_id ASC` and dialogs (≤ 2 members) are never truncated; `GET /chats/{id}/members` KEEPS its full uncapped list ordered `user_id ASC` (regression-pinned); `POST /chats` and `GET /chats/{id}` keep returning `members: []` (the `default_factory` keeps their `model_validate` path alive); pytest covers the dialog case (companion real `avatar_url` vs `None`), the cap and order, the uncapped `/members` list, and the default-field regression. |
| `AC-FE-N1` | `REQ-FE-COMPANION` | `EV-FE-1` | `ChatsPort.fetchChats(meId?: number)` passes the viewer id to the pure mapper `toChatInfo(response, meId)`; avatar ladder `chat.avatar_url` → companion real `avatar_url` → `avatarPoolUrl(companion.id)` → `''`, "lone non-me member" rule preserved (group chats and `meId === undefined` / missing `members` → no companion); `controller.fetchChats` performs ZERO `getChatUsers` calls (mocha regression pins it); `changeChatAvatar` reads the chat id from the same FormData `chatId` field the adapter reads (port contract stays `{avatar}`), patches the single chat's avatar through `chatsSlice.setChats` WITHOUT calling `fetchChats`; `applyCompanionAvatar` is deleted; mocha covers the mapper cases and the point-wise patch. |
| `AC-PROCESS` | `REQ-BE-MEMBERS`, `REQ-FE-COMPANION` | `EV-FE-1` | `npm run verify` and `npm run verify:backend` pass (test counts grow from the 319 mocha / 181 pytest baseline), `guard-architecture.mjs --all --strict` reports zero violations; `alembic heads` output unchanged (no migration); `docs/progress/progress_log.md` gets an entry and `docs/NEXT.md` retires priority 1; no file outside the manifest write-sets changes. |

## Details

### AC-BE-MEMBERS — batch, not N+1, on the server side either

The members batch mirrors `StoryService.list_feed`: collect ids, one
`User.id.in_()`-style IN query, group in Python. The claim pinned by
tests is "one IN query, zero per-chat member requests" — NOT a total
SQL-statement count: `unread_counts` keeps its current shape (three
statements plus a per-chat count for chats with read markers), and
consolidating it is a separate debt item. The cap is a guard,
not a pagination contract (the `FEED_CAP` precedent); if a real chat
ever grows to thousands of members a `ROW_NUMBER() OVER (PARTITION BY
chat_id)` window can replace the Python slice — not warranted now.
`GET /chats/{id}/members` must NOT go through the capping grouper: the
member panel expects every member; it keeps `list_members` (full,
`user_id ASC`) and only the brief ASSEMBLY is shared. `to_member_brief`
lives in the service layer and is the ONLY place the brief shape is
assembled, so `/chats` and `/chats/{id}/members` cannot drift.
`avatar_url` reuses the `schemas/file.py` helper.

### AC-FE-N1 — the adapter stays Store-free

The api layer never reads the Store (repo convention); the controller
computes `meId` once in its own `fetchChats` — the same place
`applyCompanionAvatar` used to read it — so every call site
(`main.ts`, chat page CDM, create/delete/addUsers flows) is untouched.
The real-avatar upgrade is the intended NEXT.md behaviour: the
files-relative format is already rendered by `ChatAvatar` for uploaded
chat avatars, so no template or component changes. The point-wise
`changeChatAvatar` patch drops the full refetch (which also re-ran the
WS connect loop per chat); the Store remains the single source for the
list.

### AC-PROCESS — gates and bookkeeping

`EV-BE-1` is the `npm run verify:backend` output; `EV-FE-1` is
`npm run verify` plus the guard run. The optional compose smoke (one
`GET /chats` in the network tab, dialog companion avatar, point-wise
avatar change) is an evidence NOTE, not a gate.
