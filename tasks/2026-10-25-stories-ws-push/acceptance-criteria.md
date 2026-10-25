# Acceptance criteria — 2026-10-25-stories-ws-push

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-WS` | `REQ-BE-STORIES-WS` | `EV-BE-1` | `/api/v1/ws/stories` authenticates by the access cookie, enforces the Origin allow-list (reject 1008, same as the chat socket), requires NO chat membership, answers `{'type':'ping'}` with the chat endpoint's exact pong frame and ignores other inbound events; `StoriesHub` tracks sockets by `user_id` (multi-socket per user supported), prunes stale sockets and cleans up on disconnect; `POST /stories` broadcasts `{'type':'story_created','content':<StoryResponse>}` AFTER commit with `viewed=False, is_own=False` and the uploader EXCLUDED; `DELETE /stories/{id}` broadcasts `{'type':'story_deleted','content':{'story_id':N}}` to everyone; `to_broadcast_response(story, owner)` shares the owner field mapping with the `list_feed` mapper via `_common_fields(story, owner)`; pytest covers auth rejection, foreign Origin, ping/pong, two-recipient fan-out with the fixed shape, owner exclusion (frame-order proof), disconnect cleanup and `story_deleted`; the unit test pins the invariant in executable form — `to_broadcast_response(story, owner)` equals the item `list_feed(foreign_viewer_id)` returns for that story (foreign viewer, no `StoryView` rows); no migration (`alembic heads` unchanged). |
| `AC-FE-LIVE` | `REQ-FE-LIVE-FEED` | `EV-FE-1` | A `story_created` frame routed through the stories ws module (singleton `WSTransport` on `/ws/stories`, idempotent connect whose failure is swallowed/logged — never an unhandled rejection, subscriptions registered before connect, socket reference nulled on transport Close so a later CDM reconnects) reaches `StoriesController`, which stays the sole writer of `state.stories`: duplicate id → no-op; otherwise the mapped `StoryDto` is inserted at the head of the others-unviewed group (right after the own-stories block, index 0 when none) reproducing the server feed order; `story_deleted` removes the id (absent id → no-op); the chat page CDM calls `connectStoriesSocket()` next to `fetchStories()` and the `withStore`-wrapped row re-renders without a reload; the existing chat page tests stub `connectStoriesSocket` per the CDM stub convention (no real WebSocket from unit tests) and one assertion pins the CDM call; `WSTransport` is reused UNMODIFIED; mocha covers the ws module (idempotent connect, event routing, unknown/malformed tolerance, close semantics) and the controller (insert position, dedupe, empty slice, delete, delegation, single listener registration). |
| `AC-PROCESS` | `REQ-BE-STORIES-WS`, `REQ-FE-LIVE-FEED` | `EV-BE-1`, `EV-FE-1` | `npm run verify` passes (mocha count grows from the 322 baseline), the backend gate passes (`bash backend/verify.sh`; 179 passed baseline + new tests — the 4 ingestion-converter failures are pre-existing Windows environment specifics outside the write-set), `guard-architecture.mjs --all --strict` reports zero violations, `alembic heads` output unchanged; `docs/progress/progress_log.md` gets an entry and `docs/NEXT.md` retires priority 1 (WS-push); one PR to `dev`; no file outside the manifest write-sets changes. |

## Details

### AC-BE-WS — one fixed shape, fan-out from the endpoint

The broadcast payload is viewer-independent BY CONSTRUCTION: for a
just-created story every non-owner viewer has `viewed=False,
`is_own=False`, so the server builds ONE dict instead of recomputing
per recipient; the unit test pins it against `to_response` for a
foreign viewer with an empty viewed set, so the two shapes cannot
drift. The uploader is excluded per-USER (all their sockets), not
per-socket: their client converges through the upload refetch, and the
frontend id-dedupe would make broadcast-all safe anyway. Emission
lives in the endpoints after the service commits — the sync services
never touch the hub (the `chat_deleted`/`reaction` precedent).
`model_dump(mode='json')` keeps `created_at` an ISO string over WS
exactly as over HTTP. The integration tests reuse the sync
`TestClient` + cookie + `Origin` template of
`test_http_and_ws.py:115-154` (HTTP-while-WS-open is proven by the
existing reaction test); each test opens at most 3 sockets to respect
TestClient portal capacity.

### AC-FE-LIVE — a targeted patch, not a refetch

The push handler patches the `stories` slice in place (the
`incrementUnread` precedent for adapter-side store writes is NOT used:
here the controller stays the single writer via the listener registry,
the `ChatsController` → `setChatsEventListeners` anti-cycle pattern).
Insert-at-head-of-unviewed reproduces the server order for free: a
brand-new foreign story is always unviewed and newest, and the own
block is a prefix of the slice. The dedupe makes the refetch race
(first-second-of-mount in-flight fetch overwrites the insert) benign —
it converges on the next event or mount. The socket lifecycle mirrors
the chat sockets: open on chat-page CDM, no explicit logout close
(`closeAllChatSockets` has no production call site; after a cookie
wipe the bounded reconnect exhausts itself). Events arriving while on
another page are missed by design — the feed refreshes on the next
chat-page mount (status quo).

### AC-PROCESS — gates and bookkeeping

`EV-BE-1` is the backend gate output; `EV-FE-1` is `npm run verify`
plus the guard run. The optional compose smoke (two browsers: user A
uploads → user B's ring appears live; A deletes → B's ring disappears)
is an evidence NOTE, not a gate.
