# Developer overview — 2026-10-21-avatars-stories

Two workstreams in waves: WS-BE-MEDIA (FastAPI + SQLAlchemy + Alembic +
pytest), then WS-FE-MEDIA (TypeScript + Handlebars + mocha) consuming the
fresh contract. The plan replaces the client-mock stories stage
(tasks/2026-10-21-stories) and the avatar pool stubs with real storage.

Backend map (all under `backend/app/`): the file pipeline is
`endpoints/files.py` (multipart upload, streaming download through
`asyncio.to_thread`) → `services/files.py` (`FileService`:
`prepare_upload` validates name/size/content-type and membership,
`Boto3ObjectStorage` behind `get_object_storage(settings, app.state)` —
tests override `app.state.object_storage` with a `MemoryStorage`
fixture, see `backend/tests/integration/chat/test_http_and_ws.py:77`).
Global media (avatars, story images) rides the same pipeline with
`chat_id = None` and an `image/*` whitelist; `FileService.download`
skips the member check only for that NULL branch. Stories add
`models/story.py` (`Story`, `StoryView`), `repositories/stories.py`,
`services/stories.py`, `endpoints/stories.py` (registered in
`api/v1/router.py::build_api_router` — a direct import works; the
local-import dance in `endpoints/users.py` exists only because of its
init-order cycle). Migration: `alembic/versions/007_*.py` after the
numbered 001–006 pattern, `batch_alter_table` for the widened `chat_id`
and new FKs (SQLite-safe, a no-op wrapper on PostgreSQL — the existing
chain already uses non-batch operations SQLite cannot run, and
`verify:backend` only checks `alembic heads`, so the clean
upgrade/downgrade round-trip is a manual evidence note against the
compose PostgreSQL, not an automated gate). `story_ttl_hours` joins
`core/config.py::Settings`. The avatar URL contract is
`avatar_url = "{file_id}/download"` (no leading slash) or null,
implemented as a Python property on the `User`/`Chat` models so the
from_attributes response models pick it up; hand-built responses
(`list_chats`, `get_chat`, members) pass it explicitly, and the members
query widens in `repositories/chats.py` / `services/chats.py` (the
repository currently returns `(user_id, email)` tuples only). Feed
items expose `image_url` the same way.

Frontend map: the stories module lives INSIDE the chats feature —
`src/features/chats/stories/` (`ports.ts` importing nothing beyond
types, `api/own.ts` + `api/index.ts`, module-owned `store.ts` slice
setter following `chatsSlice`, singleton `controller.ts`) — because the
architecture guard blocks cross-feature imports from the chat page
(`src/features/chats/history/` is the precedent module). The chat page
keeps every lifecycle duty it already owns from the stories plan: the
auto-close timer (cleared before re-arm / on close / in `destroy()`),
the overlay focus restore in `componentDidUpdate`, the delegated
`change` events prop re-attached by `_addEvents` — hbs children are
re-instantiated per re-render without `destroy()`, so nothing moves
into components. The page drops `initialStories`, `addStoryFromFile`
and `URL.createObjectURL`; server ids are stringified into
`StoryItem.id` and `markViewed` gets the numeric id. The Store slice is
the single source of truth: the page never writes stories props (a
local patch would race the withStore mapping on unrelated store
events); `markViewed` patches the slice synchronously before its POST
and the ring fades through the withStore re-render. Uploads are never
optimistic — the controller awaits the port call and refetches (the
feed already orders own stories first). Avatar components
(`UserAvatar`, `ChatAvatar`) already resolve non-slash-prefixed values
through `fileUrl` and treat leading-`/` values as app static assets —
that is exactly why the API returns `{file_id}/download` and the
adapters fall back to `avatarPoolUrl(id)`; story feed URLs are
resolved to absolute URLs inside the own adapter because the `Story`
tile takes `src` as-is. `changeChatAvatar` needs no port signature
change: the UI file input already appends the clicked tile's chat id to
the FormData as `chatId` (`src/components/input/inputFile/inputFile.ts`)
— read it there, not from selectedChat. The profile port narrows
`changeAvatar` to `Promise<{ avatar: string }>`; the controller
patches `state.user.avatar`.

Style: TS — 4-space indent, single quotes, no semicolons, `.ts`
imports, Russian comments at the file's density; Python — the
backend's existing typing/formatting (ruff if configured, otherwise
match the neighbouring files); tests `src/**/*.test.ts` (mocha + chai
+ sinon + jsdom) and `backend/tests/**` (pytest, sqlite in-memory via
conftest). Frontend suite ~297 tests stays green; pre-commit runs
`npm run verify`, so fix lint (`eslint:fix`, `stylelint:fix`) before
committing.

Validation: `npm run verify:all` (frontend verify + backend
verify:backend) and
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict`
for the frontend worker. WS-BE-MEDIA must not touch `src/`; WS-FE-MEDIA
must not touch `backend/`.

Manual checklist notes for the task results (not jsdom-provable, not
gate claims): story photo loads over the network from the API origin
with the session cookie; avatar upload from the profile page and the
chat header refreshes the visible avatar; the unread ring on a freshly
uploaded story fades after viewing it; the migration round-trip note
(backend worker, against compose PostgreSQL).
