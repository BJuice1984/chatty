# Plan — 2026-10-21-avatars-stories (avatars + stories on the own backend)

Two workstreams in dependency order: WS-BE-MEDIA (backend contract first),
then WS-FE-MEDIA (frontend consumes it). Base is the head of
`feature/2026-10-21-stories` (87b7e87) — the mock stories stage this plan
replaces lives there, and chats-social is still unmerged to dev, so this
branch stacks on top; the PR targets `dev` after chats-social and
2026-10-21-stories land. Contingency: rebase
`feature/2026-10-21-avatars-stories` onto `dev` when both merge; do not open
the PR before that.

Contract decisions (verified against the code at base, re-verified by the
round-1 independent review):
- `File.chat_id` is NOT NULL today and chat uploads validate chat membership
  (`FileService.prepare_upload` / `_require_member`), so global media
  (avatars, story images) cannot ride the chat-attachment path. The plan
  widens `files.chat_id` to nullable: chat attachments keep the exact
  current behaviour (member-only upload and download), while `chat_id IS
  NULL` rows are global media uploaded through new endpoints and readable by
  any authenticated user via the existing `GET /files/{id}/download`
  streaming endpoint.
- Avatar components already resolve non-slash-prefixed avatar values through
  `fileUrl` (`UserAvatar`, `ChatAvatar` treat leading-`/` values as app
  static assets — the avatar pool). The API therefore returns avatar_url as
  `"{file_id}/download"` (no leading slash) and the frontend adapters keep
  `avatarPoolUrl(id)` as the null fallback. Story feed URLs are resolved to
  absolute URLs inside the own adapter (the `Story` tile takes `src` as-is).
- Stories state lives in a Store slice (`state.stories`) owned by a module
  INSIDE the chats feature — `src/features/chats/stories/` (the
  `chats/history` precedent): a separate `src/features/stories` feature
  would force a cross-feature import from the chat page, which the
  architecture guard blocks (blocker, independent of layers). The page
  keeps every lifecycle duty it already owns (timer, overlay focus,
  delegated change) — the viewer stays presentational, no timers inside.

## WS-BE-MEDIA

1. Migration `backend/alembic/versions/007_avatars_stories.py` (follow the
   style of 006): `files.chat_id` -> nullable (FK and CASCADE stay);
   `users.avatar_file_id` INT NULL FK `files.id` ON DELETE SET NULL;
   `chats.avatar_file_id` INT NULL FK `files.id` ON DELETE SET NULL; new
   `stories` (id PK autoincrement, owner_id INT NOT NULL FK users.id ON
   DELETE RESTRICT, file_id INT NOT NULL UNIQUE FK files.id ON DELETE
   CASCADE, created_at tz-aware NOT NULL) and `story_views` (story_id FK
   stories.id ON DELETE CASCADE + user_id FK users.id ON DELETE CASCADE,
   composite PK, viewed_at tz-aware NOT NULL). Use `batch_alter_table` for
   the widened `chat_id` column and the added FKs/columns (required on
   SQLite, a no-op wrapper on PostgreSQL). Downgrade reverses all five
   steps. Gate reality (review PR-3): `npm run verify:backend` runs pytest
   + `alembic heads` only; the clean upgrade/downgrade round-trip is
   demonstrated once manually against the compose PostgreSQL (runbook
   `docs/deployment/own-backend.md`) and recorded as an evidence NOTE in
   the task result — it is not an automated gate and must not burn attempts.
2. Models: `File.chat_id: int | None`; `User.avatar_file_id: int | None` +
   `@property avatar_url -> str | None` (`f"{avatar_file_id}/download"` or
   None); `Chat.avatar_file_id: int | None` with the same `avatar_url`
   property — from_attributes response models pick the properties up, no
   hand-built payloads in endpoints; new
   `backend/app/models/story.py` (`Story`, `StoryView`) registered in
   `models/__init__.py`.
3. Schemas: `FileResponse.chat_id: int | None`; new `schemas/story.py` with
   `StoryResponse {id, owner_id, owner_display_name, owner_avatar_url,
   image_url, created_at, viewed}`; `schemas/auth.py` user response gains
   `avatar_url: str | None` (populated by the model property);
   `schemas/chat.py` `ChatResponse` gains `avatar_url: str | None` (same).
   `get_chat` stays `ChatResponse.model_validate(chat)` and picks the
   property up through from_attributes; only the hand-built `list_chats`
   and members responses pass the value explicitly.
4. `backend/app/services/files.py`:
   - `download()`: when `file.chat_id is None`, skip the member check (any
     authenticated user reads global media); chat attachments keep the
     participant check exactly as now;
   - new upload path for global media (e.g. `prepare_media_upload` /
     `upload_media`): same name/size/content-type validation as
     `prepare_upload` plus an `image/*` content-type whitelist (400
     `invalid_content_type` otherwise), no chat membership check,
     `object_key=f"media/{uuid4().hex}"`, `chat_id=None`;
   - avatar setters: point `users.avatar_file_id` / `chats.avatar_file_id`
     at the uploaded file (own avatar: current user; chat avatar: require
     chat owner — 404 unknown chat, 403 non-owner) and commit.
5. New `backend/app/services/stories.py` + `repositories/stories.py`:
   - `create(owner_id, uploaded-file fields)`: File row (global media path)
     + Story row in one service call, storage upload with the same
     failed/ready status marking as the chat path;
   - `list_feed(user_id, ttl_hours)`: active stories only
     (`created_at >= now - ttl`), cap 100: caller's own first, then others,
     each group `created_at desc`; `viewed` resolved with one
     `story_views` query for the caller; `owner_display_name` = email local
     part (same rule as `UserSearchItem.from_user`), `owner_avatar_url`
     from the owner's `avatar_file_id`;
   - `mark_viewed(story_id, user_id)`: idempotent upsert (INSERT if absent),
     no error on expired stories.
   `core/config.py`: `story_ttl_hours: int = 24` (pydantic settings field).
6. Endpoints:
   - `files.py`: `POST /files/avatars` multipart — `kind: str = Form`
     ('user' | 'chat'; 422/400 otherwise), `chat_id: int | None = Form(None)`
     (required when kind='chat'), `uploaded` — reuses the async
     to_thread/streaming pattern of `upload_file`; response: FileResponse
     plus `avatar_url`;
   - new `endpoints/stories.py` router (prefix `/stories`): `POST ''`
     (multipart `uploaded` -> StoryResponse, 201), `GET ''` (list[StoryResponse]),
     `POST '/{story_id}/view'` (204); register it in
     `api/v1/router.py::build_api_router` next to `files` (direct import —
     stories has no circular-init problem; the users.py local-import dance
     is not needed);
   - `chats.py`: fill `avatar_url` in `list_chats` (hand-built); `get_chat`
     keeps `model_validate` and inherits the property via from_attributes
     (create stays null);
   - `list_chat_members` gains `avatar_url` per member: widen the members
     query in `repositories/chats.py` (`list_members` currently returns
     `(user_id, email)` tuples only) and/or the service layer
     (`services/chats.py`) to carry the member's `avatar_file_id` — keep the
     repository pattern, do not query the session from the endpoint.
7. Tests (`pytest`, MemoryStorage fixture pattern from
   `test_http_and_ws.py:77`):
   - new `backend/tests/integration/chat/test_media_api.py`: user avatar
     upload (multipart) -> avatar_url in `/auth/me` and in
     `GET /chats/{id}/members`; chat avatar upload by owner -> avatar_url
     in `GET /chats`; chat avatar upload by non-owner -> 403; non-image
     content type (text/plain) -> 400; oversize body -> 413 (existing
     settings value);
   - new `backend/tests/integration/chat/test_stories_api.py`: upload ->
     feed shows it first with `viewed: false` and image_url
     `{file_id}/download`; second user's view -> `viewed: true` for them,
     false for others; repeat view -> still 204, single row; feed ordering
     (own first, then others, newest first); a story older than
     `story_ttl_hours` disappears from the feed (insert with a backdated
     `created_at` via the session fixture) while `view` on it stays 204;
     unauthenticated access -> 401;
   - access regression in `test_http_and_ws.py` (or the new media test
     file): chat attachment download by a non-member stays 403; global
     media (avatar) download by a non-member is 200;
   - unit test for the feed query semantics (own-first ordering + TTL
     filter) if cheaper to pin there than through HTTP.
8. Gate: `npm run verify:backend` (pytest + alembic heads) green; no
   frontend files touched.

## WS-FE-MEDIA

1. `src/utils/Store.ts`: declare `stories?: { [key: string]: unknown }[]`
   in `AppState` — weakly typed exactly like the existing `chats` slice;
   the concrete `StoryDto` type lives in
   `src/features/chats/stories/ports.ts` and the module slice setter casts
   on read (the `chatsSlice` pattern). NO type imports from `features/`
   into `src/utils/Store.ts`: the architecture guard's layer check does not
   exempt type-only imports (utils -> features is a blocker).
2. New module `src/features/chats/stories/` (inside the chats feature —
   the guard blocks cross-feature imports from the page; `chats/history`
   is the precedent module layout):
   - `ports.ts`: `StoriesPort {fetchStories(): Promise<StoryDto[]>;
     uploadStory(file: File): Promise<void>;
     markViewed(id: number): Promise<void>}` with
     `StoryDto {id: number; owner: string; ownerAvatarUrl: string;
     src: string; alt: string; viewed: boolean}` — ports import nothing
     beyond types (same self-containment rule);
   - `api/own.ts` (+ `api/index.ts` re-export): GET `/stories` maps items
     to `StoryDto` with `src = fileUrl(image_url)`, `alt` synthesized from
     the owner name (the backend feed has no alt field, e.g.
     `История ${owner}`) and `ownerAvatarUrl` resolved through `fileUrl`
     when present, else the pool URL; `uploadStory` POSTs FormData
     `{uploaded: file}` with `csrfToken`; `markViewed` POSTs
     `/stories/{id}/view` with `csrfToken`;
   - `store.ts`: `chatStoriesSlice` (get/set `state.stories`, module-owned,
     the `chatsSlice` pattern);
   - `controller.ts`: singleton; `fetchStories()` writes the mapped slice;
     `uploadStory(file)` awaits the port then refetches; `markViewed(id)`
     patches the slice SYNCHRONOUSLY first (ring fades through the
     withStore re-render), then fires the POST un-awaited (failure logged,
     the next fetch reconciles).
3. `src/features/chats/pages/chat/chat.ts` (template `chat.hbs` needs no
   change — the row stays an each-list over the `stories` prop):
   - remove `initialStories`, the mock tiles and `URL.createObjectURL`/
     `addStoryFromFile`; keep `ADD_STORY_ID`, the add tile (page-built
     static first item, `type: 'add'`) and `STORY_VIEW_DURATION_MS`;
   - stories come from the Store: the `withStore` mapping adds
     `stories: state.stories`; the render list is
     `[addTile, ...(stories ?? [])]` with numeric server ids stringified
     to keep `StoryItem.id: string` (single id type through the page);
   - CDM calls `void storiesController.fetchStories()` next to
     `fetchChats`;
   - close path (`closeStory`): the page ONLY resets the viewer
     (`setProps viewerStory: null`) — no local stories patch (a local patch
     would race the withStore mapping on any unrelated store event); the
     ring fade is the controller's synchronous slice patch inside
     `markViewed(Number(id))`, called once per close for a real story id
     (never for the add tile, never when `id == null`);
   - the delegated change handler calls
     `void storiesController.uploadStory(file)` (input value reset stays);
     no optimistic blob insertion — the refetched feed lands the new story
     first with the unread ring;
   - viewer, timer, focus, destroy semantics: untouched.
4. Avatars:
   - `src/features/auth/api/own.ts`: `OwnUserResponse.avatar_url?: string |
     null`; `toAuthUser` avatar = `response.avatar_url ?? avatarPoolUrl(id)`;
   - `src/features/chats/api/own.ts`: `OwnChatResponse.avatar_url?`;
     `toChatInfo` avatar = `response.avatar_url ?? ''` (companion-avatar
     fallback logic in the controller already respects a non-empty chat
     avatar); `getChatUsers` member avatar =
     `member.avatar_url ?? avatarPoolUrl(member.id)`;
     `changeChatAvatar` implemented WITHOUT a port signature change: the
     UI file input already appends the clicked tile's chat id to the
     FormData as `chatId` (src/components/input/inputFile/inputFile.ts —
     the id of the chat whose avatar tile was clicked, which may differ
     from selectedChat); the adapter reads `data.get('chatId')`, takes the
     file from the UI `avatar` field, rebuilds FormData
     `{uploaded, kind: 'chat', chat_id}` and POSTs `/files/avatars` with
     csrf, returning `{avatar}`;
   - `src/features/chats/controller.ts`: `changeChatAvatar(data)` — on
     success `void this.fetchChats()` (drop the `newChatAva` store
     write); `applyCompanionAvatar` unchanged;
   - `src/features/profile/ports.ts`: `changeAvatar(data: FormData)`
     narrows to `Promise<{ avatar: string }>`;
   - `src/features/profile/api/own.ts`: `changeAvatar` implemented —
     rebuild FormData `{uploaded, kind: 'user'}` from the UI field, POST
     `/files/avatars`, return `{avatar: avatar_url}`;
   - `src/features/profile/controller.ts`: `changeUserAvatar` patches
     `state.user` (`{...user, avatar}` through the profile slice) from the
     response avatar_url.
5. Tests (mocha, existing jsdom patterns; adapter tests mock HTTPTransport
   the way `features/auth/api/api.test.ts` does):
   - new `src/features/chats/stories/api/api.test.ts`: feed mapping
     (viewed flag, fileUrl resolution of image_url/owner_avatar_url),
     upload FormData shape, markViewed URL and csrf;
   - new `src/features/chats/stories/controller.test.ts`: fetchStories
     writes the slice; markViewed flips one item synchronously before the
     POST; uploadStory awaits upload then refetch;
   - `src/features/chats/api/api.test.ts`: toChatInfo avatar_url mapping;
     changeChatAvatar FormData rebuild (kind=chat, chat_id from the
     chatId field); members avatar mapping with pool fallback;
   - `src/features/auth/api/api.test.ts`: toAuthUser avatar_url with and
     without null;
   - `src/features/profile/api/api.test.ts`: the current suite pins
     `changeAvatar` as unsupported — rework that case into the real
     contract (FormData rebuild into `{uploaded, kind: 'user'}`, mocked
     `{avatar: avatar_url}` response);
   - `src/features/chats/pages/chat/chat.test.ts`: stories render from
     Store props (no initialStories), add tile stays first; the close path
     calls markViewed exactly once per close with the numeric id and does
     NOT write stories props locally (the ring fades via the Store
     mapping); the delegated change path now calls the controller upload
     (stubbed) and does not create blob URLs; existing timer/focus tests
     keep passing (they already pin the 5000 ms behaviour).
6. Docs: `docs/progress/progress_log.md` entry at the top.

Verification (both workstreams): `npm run verify:all`, then
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict`.
