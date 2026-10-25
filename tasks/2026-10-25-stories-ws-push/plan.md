# Plan — 2026-10-25-stories-ws-push

Make the stories feed live: today it refreshes only on chat-page mount or
after the user's own upload/delete (controller refetch). When ANY user
uploads a story, every other connected client gets a WebSocket event and
the stories row updates in place — a new foreign ring appears; on delete
the ring disappears. Scope confirmed by the operator 2026-10-25:
**`story_created` + `story_deleted`**, nothing else.

## Why a dedicated channel (the architecture decision)

Stories are a GLOBAL feed (any authenticated user sees everyone's active
stories; the backing `File` row has `chat_id=None`), but the only WS
endpoint today is per-chat (`/api/v1/ws/chats/{id}`) and `ChatHub` is
keyed by `chat_id` — there is no user→socket registry and no global
channel. Pushing through chat sockets would deliver one duplicate per
open chat and miss users with zero chats. So: a lightweight
`/api/v1/ws/stories` endpoint plus a user-keyed `StoriesHub`, mirroring
the existing WS endpoint's auth and lifecycle exactly.

## Event contract (the decoupling point for the two waves)

Envelope is the repo standard `{'type': str, 'content': Any}`.

- `story_created` — content is a viewer-independent `StoryResponse`
  dict: for a brand-new story every non-owner has `viewed=False,
  is_own=False` by construction, so the server broadcasts ONE fixed
  shape (no per-viewer recomputation). Built by a new
  `StoryService.to_broadcast_response(story)` sharing the field mapping
  with `to_response` (a private `_common_fields` helper) so the two
  cannot drift. The uploader is EXCLUDED (`exclude_user_id` on the hub
  broadcast): their client already converges via its upload refetch;
  the frontend id-dedupe makes a later switch to broadcast-all safe.
- `story_deleted` — content `{'story_id': N}`, broadcast to everyone
  (removal is idempotent per client; the owner's other tabs win).

Emission happens in the ENDPOINTS after the service commits (the
`chat_deleted`/`reaction` precedent in `chats.py`), never inside the
sync service layer. `model_dump(mode='json')` (Pydantic v2) so
`created_at` serializes to ISO over WS exactly like over HTTP.

The endpoint answers client keepalive `ping` with
`{'type': 'pong', 'content': {}}` (WSTransport pings every 5 s while
open — the chat endpoint's exact frame), ignores every other inbound
event, and requires NO chat membership: cookie auth + Origin check only
(reject 1008, same as the chat socket).

## Wave 1 — backend (WS-BE-STORIES-PUSH)

1. `backend/app/ws/hub.py` — `StoriesHub` next to `ChatHub`:
   `connect(user_id, ws)` / `disconnect(user_id, ws)` (pop the empty
   set) / `broadcast(payload, *, exclude_user_id=None)` iterating a
   snapshot (`list(...)`) with the same try/except + prune-stale policy
   as `ChatHub.broadcast`; singleton `stories_hub`.
2. `backend/app/ws/router.py` — `/ws/stories` endpoint copying
   `chat_websocket`'s structure: Origin check → `_user_from_websocket`
   (sync helper, does NOT accept) → `accept()` → `stories_hub.connect`
   → receive loop (only `ping` → pong) → `finally: disconnect`. No
   membership check.
3. `backend/app/services/stories.py` — `to_broadcast_response(story,
   owner)` with `viewed=False, is_own=False` over
   `_common_fields(story, owner)` shared with the `list_feed` mapper
   closure (today `to_response(story)` — `services/stories.py:46` —
   captures `owners`/`viewed_ids`; the refactor lifts the owner
   field-mapping into `_common_fields(story, owner)` used by both, so
   the shapes cannot drift). The owner `User` (email local part +
   avatar_file_id) is passed by the caller — `create_story` has
   `current_user`. NOT a `to_response(story, owner_id, ...)` call:
   owner-view `viewed` semantics would produce the wrong result.
4. `backend/app/api/v1/endpoints/stories.py` — `create_story`:
   `story_created` broadcast of `to_broadcast_response(story,
   current_user).model_dump(mode='json')` with
   `exclude_user_id=current_user.id` after `StoryService.create`;
   `delete_story`: `story_deleted` broadcast after the successful
   delete.
5. pytest — new `backend/tests/integration/chat/test_stories_ws.py`
   (sync `TestClient` template from `test_http_and_ws.py:115-154`,
   cookies from register, `Origin: http://localhost:3000`,
   `app.state.object_storage = MemoryStorage()`, ≤3 sockets per test):
   (1) no cookie → reject like the chat WS; (2) foreign Origin → 1008;
   (3) ping → pong; (4) two recipients' sockets both receive
   `story_created` with `viewed=False, is_own=False, owner_id` of the
   uploader; (5) the uploading owner (socket open) does NOT receive
   `story_created` — proven by frame order: after the upload the next
   frame on the owner's socket is the pong; (6) after a recipient
   disconnects, new events reach only the remaining recipient;
   (7) `story_deleted` reaches both with `{story_id}`. Extend
   `backend/tests/unit/chat/test_stories_service.py`: the invariant in
   its executable form — `to_broadcast_response(story, owner)` equals
   the item `list_feed(foreign_viewer_id)` returns for that story
   (foreign viewer, no `StoryView` rows): fixed shape ==
   per-viewer-for-non-owners.

No migration (`alembic heads` output unchanged).

## Wave 2 — frontend (WS-FE-STORIES-PUSH)

1. `src/features/chats/stories/api/own.ts` — export the existing
   private `toStoryDto` (it already copies `viewed`/`is_own` verbatim
   and resolves `fileUrl()`/`avatarPoolUrl`/alt). No separate mapper
   module: both consumers live in the feature, no cycle.
2. New `src/features/chats/stories/ws/gateway.ts` — single-listener
   registry, the `chats/ws/gateway.ts` anti-cycle pattern:
   `StoriesSocketEvent = {kind:'story_created', content: OwnStoryResponse-ish}
   | {kind:'story_deleted', content: {story_id: number}}`,
   `setStoriesSocketListener(fn)`, module-internal
   `notifyStoriesSocketEvent(event)`.
3. New `src/features/chats/stories/ws/own.ts` — singleton over
   `WSTransport` (reused UNMODIFIED: bounded reconnect, 5 s ping,
   explicit close never reconnects):
   `ownStoriesUrl() = joinUrl(env.wsUrl, '/ws/stories')` (the
   `ownChatUrl` pattern); `connectStoriesSocket()` idempotent
   (`socket !== null` → return), subscriptions registered BEFORE
   `connect()` (Connected fires synchronously on open — the
   `chats/ws/own.ts:147` comment); the `Message` callback receives the
   already-parsed `{type, content}` and routes `story_created` /
   `story_deleted` to `notifyStoriesSocketEvent`, unknown types
   silently ignored; a failed `connect()` must NOT surface as an
   unhandled rejection (the transport's bounded reconnect already
   retries — swallow/log the rejection so unit tests and the page
   never crash on a refused socket); `closeStoriesSocket()` calls
   `socket?.close()`; the transport `Close` event nulls the module
   reference so the next chat-page CDM opens a fresh socket after
   reconnect exhaustion.
4. `src/features/chats/stories/controller.ts` — stays the sole writer
   of `state.stories`: constructor registers
   `setStoriesSocketListener(event => this.handleSocketEvent(event))`
   (the `ChatsController` → `setChatsEventListeners` precedent);
   public `connectStoriesSocket()` delegates to the ws module.
   `handleStoryCreated(raw)`: `toStoryDto(raw)`, id-dedupe (no-op on a
   duplicate — refetch race, replayed event), insert at
   `countLeadingOwnStories(current)` — right after the own block,
   i.e. the head of the others-unviewed group (a brand-new foreign
   story is always unviewed and newest, reproducing the server feed
   order: own first, then others unviewed-before-viewed, newest-first).
   `handleStoryDeleted({story_id})`: no-op when absent, else
   `filter(id !== story_id)`. An open viewer of a deleted story is
   left to the page's existing 5 s close timer (accepted limit).
5. `src/features/chats/pages/chat/chat.ts` — CDM, right after
   `void StoriesController.fetchStories()`: `StoriesController.
   connectStoriesSocket()`. The page is already `withStore`-wrapped on
   `stories`, so the slice patch re-renders the row live. No explicit
   close on logout — symmetry with the chat sockets
   (`closeAllChatSockets` has no production call site; after a cookie
   wipe the bounded reconnect exhausts itself).
6. `src/features/chats/pages/chat/chat.test.ts` — the 18 existing
   `new ChatPage(...)` tests stub every CDM controller side effect
   (`fetchChats` everywhere, the stories methods in the stories
   describes); add `connectStoriesSocket` to that stub convention so
   the page tests never touch the real WebSocket (mochaSetup.ts has
   no WebSocket global — on Node ≥ 22.12 the native undici client
   would really dial `ws://localhost:8000`), plus one new assertion
   that CDM calls `connectStoriesSocket` alongside `fetchStories`.
7. mocha — new `src/features/chats/stories/ws/own.test.ts` (the
   `chats/ws/ws.test.ts` FakeWebSocket + `connectedSocket()` pattern):
   one socket to `/ws/stories` + idempotent second connect;
   `story_created` frame invokes the registered listener with parsed
   content; unknown type / malformed payload do not throw;
   close → reconnect opens a NEW socket; no handling after close.
   Extend `controller.test.ts` (stub the ws module; reset the slice):
   insert after the own block (`[own1, own2, unviewed, viewed]` →
   index 2); insert at 0 with no own stories; duplicate id no-op;
   empty/undefined slice; delete removes / absent id no-op;
   `connectStoriesSocket` delegates (sinon stub); constructor
   registers exactly one listener. One `toStoryDto` case on a
   `viewed=false, is_own=false` payload (absolute `src`, pool avatar
   fallback) in `api.test.ts` or the ws test.

## Out of scope

Live updates while NOT on the chat page (socket opens on chat-page CDM;
missed events converge on the next mount — status quo); pushing story
VIEWS to other clients; TTL-expiry pushes (a pushed story may expire
server-side while sitting in a slice — same click behavior as a stale
mount today); opening the stories socket on login/registration pages;
`WSTransport` changes; unread-badge stories counter (rings themselves
carry unreadness); the owner's OTHER tabs receiving `story_created`
(they converge on next mount; broadcast-all is a one-line flip if the
operator ever wants it — the frontend dedupe already tolerates it).

## Verification

`npm run verify`; backend gate
(`PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe bash
backend/verify.sh` — on Windows npm run verify:backend does not resolve
the .sh through cmd; the 4 ingestion-converter failures are
pre-existing Windows environment specifics, outside the write-set);
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict`;
`alembic heads` unchanged. Optional compose smoke (two browsers, ring
appears/disappears live) is an evidence NOTE, not a gate.
