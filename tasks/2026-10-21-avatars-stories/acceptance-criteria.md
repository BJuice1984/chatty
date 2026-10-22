# Acceptance criteria — 2026-10-21-avatars-stories

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-AVATARS` | `REQ-AVATAR-BACKEND` | `EV-BE-1` | Migration 007 is written with `batch_alter_table` (SQLite-safe, PostgreSQL-neutral) and reverses all five steps in downgrade; a manual upgrade/downgrade round-trip against the compose PostgreSQL is recorded as an evidence NOTE (not an automated gate — `verify:backend` runs pytest + `alembic heads` only); `POST /files/avatars` stores a user or chat avatar in object storage with an image/*-only whitelist (400 on `text/plain`), size limit (413) and owner-only chat avatars (403 non-owner); `avatar_url` (`"{file_id}/download"`, null when absent — a model property picked up by from_attributes responses) appears in the `/auth/*` user responses, `GET /chats`, `GET /chats/{id}` and `GET /chats/{id}/members` (members query widened in the chat repository/service); pytest covers all listed paths. |
| `AC-BE-ACCESS` | `REQ-AVATAR-BACKEND` | `EV-BE-1` | `GET /files/{id}/download` keeps participant-only access for chat attachments (outsider 403 regression-pinned) while global media (`chat_id IS NULL`: avatars, story images) downloads for any authenticated user (200); no other access path widens. |
| `AC-BE-STORIES` | `REQ-STORIES-BACKEND` | `EV-BE-1` | `POST /stories` accepts a multipart image (same validation as avatars); `GET /stories` returns active stories only (TTL `story_ttl_hours`, default 24) capped at 100, caller's own first then others, newest first inside each group, with `viewed` resolved per caller; `POST /stories/{id}/view` is idempotent (204, single `story_views` row) and stays 204 for an expired story; pytest pins ordering, TTL filtering, per-viewer viewed state and 401 without auth. |
| `AC-FE-STORIES` | `REQ-STORIES-FRONT` | `EV-FE-1` | The stories module lives INSIDE the chats feature (`src/features/chats/stories/`, the chats/history precedent — a cross-feature import would block the guard); the chat page renders `state.stories` from the Store (mock `initialStories`, `ava-*.jpg` tiles and the `URL.createObjectURL` path are gone; the add tile stays the static first tile); page CDM fetches the feed; every viewer close route only resets the viewer (`setProps viewerStory: null`) and calls the controller's `markViewed` exactly once with the numeric server id (never for the add tile) — the ring fades through the controller's SYNCHRONOUS Store-slice patch rendered by withStore, and the page never writes stories props itself (no race with unrelated store events); the delegated file-input change calls `uploadStory` (no optimistic blob insertion) and the refetched feed shows the new story first with the unread ring; mocha pins the page contract (stubbed controller) and the adapter/controller units. |
| `AC-FE-AVATARS` | `REQ-AVATARS-FRONT` | `EV-FE-1` | `toAuthUser` and chat/member mappings use `avatar_url` with `avatarPoolUrl(id)` fallback; `changeChatAvatar(data)` keeps its port signature and reads the chat id from the UI FormData `chatId` field (the clicked tile's chat, not necessarily selectedChat), rebuilding the FormData into the `{uploaded, kind='chat', chat_id}` contract and refetching chats on success; profile `changeAvatar` narrows to `Promise<{avatar: string}>`, posts `{uploaded, kind='user'}` and patches `state.user.avatar`; the companion-avatar rule (a chat's own avatar is never overwritten) is preserved; mocha covers the adapter mappings and FormData rebuilds. |
| `AC-PROCESS` | `REQ-AVATAR-BACKEND`, `REQ-STORIES-BACKEND`, `REQ-STORIES-FRONT`, `REQ-AVATARS-FRONT` | `EV-FE-1` | `npm run verify:all` passes end to end (typecheck, mocha, eslint, stylelint, backend pytest + alembic); `guard-architecture.mjs --all --strict` passes; `docs/progress/progress_log.md` gets an entry; no file outside the manifest write-sets changes. |

## Details

### AC-BE-AVATARS — global media design

`File.chat_id` becomes nullable because avatars and story images have no
chat binding; the existing chat-attachment path (member-checked upload,
member-only download) is preserved verbatim. Object keys for global media
use a `media/` prefix; `avatar_url` values are file-relative
(`{file_id}/download`, no leading slash) matching the frontend convention
where avatar components resolve non-slash values through `fileUrl` and
treat leading-`/` values as app static assets (the avatar pool). The value
is a Python property on the `User`/`Chat` models so the from_attributes
response models pick it up; hand-built responses (`list_chats`, `get_chat`,
members) pass it explicitly, and the members query widens in the chat
repository/service (not in the endpoint). The migration uses
`batch_alter_table` for the altered column and FKs; the round-2 review
confirmed `verify:backend` cannot prove upgrade/downgrade, so that
round-trip is a manual evidence note against the compose PostgreSQL.

### AC-BE-ACCESS — no widening beyond global media

Only the `chat_id IS NULL` branch skips the member check in
`FileService.download`; every other guard (ready status, storage failure
mapping, 404s) stays. The regression test pins the outsider-403 behaviour
for chat attachments next to the global-media 200.

### AC-BE-STORIES — feed semantics

`owner_display_name` follows the `UserSearchItem` rule (email local part);
TTL filtering happens in the feed query with `settings.story_ttl_hours`;
the backdated-`created_at` test inserts rows through the session fixture
(no free-clock hacks). Cap 100 is a guard, not a pagination contract.

### AC-FE-STORIES — page keeps its lifecycle duties, Store owns the data

The viewer stays presentational; the page keeps the timer, the overlay
focus restore and the delegated `change` (re-attached by `_addEvents` on
every re-render). The module lives inside the chats feature because the
architecture guard blocks cross-feature imports (the round-1 review's
PR-1). The server id is stringified into `StoryItem.id` so the page keeps
a single id type; `markViewed` receives the numeric id and patches the
Store slice synchronously before its POST — the page itself never writes
stories props (round-1 PR-5: a local optimistic patch would race the
withStore mapping on any unrelated store event). Upload is never
optimistic: the tile list updates only after the refetch, which the
backend already orders (own stories first).

### AC-FE-AVATARS — fallback ladder

A user/chat without an uploaded avatar keeps the deterministic pool URL;
uploads replace it with the file URL. `applyCompanionAvatar` logic is
untouched — it already refuses to overwrite a non-empty chat avatar.

### AC-PROCESS — gates and bookkeeping

Evidence for `EV-BE-1` is the `npm run verify:backend` output captured by
the backend worker; `EV-FE-1` is `npm run verify:all` plus the guard run
captured by the frontend worker (the frontend gate re-runs the backend
suite, so the final state is pinned once more end to end).
