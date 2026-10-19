# Stage 14: block-cdm

Single workstream WS-BLOCK-CDM. Today `FLOW_CDM` is emitted only by
`dispatchComponentDidMount()` which nobody calls: `componentDidMount` never
fires anywhere (discovered live as LIVE-3; ChatPage uses a constructor
workaround, AssistantPage's `loadChats` CDM is dormant dead code that only
survived because the main.ts bootstrap happens to fill the chat store).

1. `src/core/Block.ts`: `dispatchComponentDidMount()` also recurses into
   `_hbsChildren` (currently only `this.children` — hbs-embedded children
   would be skipped). Guard: a per-instance mounted flag checked at the top
   of dispatch with a FULL short-circuit (no descent into children — each
   node is protected by its own flag); no reset in destroy() — a destroyed
   instance cannot fire anyway because destroy() offs the lifecycle handlers
   (proven by the existing Block test). Consequence fixed as semantics:
   children created AFTER mounting by re-renders (compile replaces
   `_hbsChildren` wholesale) receive no CDM — the lifecycle covers the tree
   as it was at mount time. Keep the init → render flow untouched.
2. `src/utils/Router.ts`: the module-level `render()` helper calls
   `block.dispatchComponentDidMount()` after `root.append(block.getContent())`
   — the single activation point for every route. Remount contract (F-1):
   CDM fires exactly once per instance. `Route.render` on an existing
   instance only `setProps({routeParams})` — no re-dispatch on a same-route
   revisit; leaving a route destroys the instance (`leave()`), so returning
   to the route mounts a fresh instance with a fresh CDM — this is exactly
   what keeps the LIVE-3 invariant «chats on every visit» alive.
3. `src/features/chats/pages/chat/chat.ts`: move `fetchChats()` from the
   constructor into `componentDidMount`, drop the workaround comment.
4. `src/features/ai-assistant/pages/assistant.ts`: keep the existing
   `componentDidMount → loadChats` (it comes alive); verify no constructor
   duplication.
5. Tests: `src/core/Block.test.ts` — CDM fires on dispatch, recurses into
   both child kinds with the SAME child set destroy() walks (named dispatch ↔
   destroy symmetry invariant), no double fire; `src/utils/Router.test.ts` —
   the mounted page receives CDM; extend the existing same-route-revisit
   test: revisit with new params → CDM count 1, leave → return → count 2;
   `src/features/chats/pages/chat/chat.test.ts` — chats fetch on CDM with the
   LIVE-3 regression intent preserved: a fresh visit re-fetches AND an
   explicit assert that the constructor no longer fetches (comment links the
   LIVE-3 finding); assistant page test — loadChats on CDM.
6. Live re-smoke on the operator stack. The double-fetch safety rests on
   two named properties (F-2): OwnWsAdapter.connect dedupes by
   `sockets.has(id)` with a synchronous set before the await (no TOCTOU),
   and Store.set suppresses the second identical setChats by the content
   comparison — NOT on GET idempotency alone. Measurable smoke expectation:
   cold /messenger load → exactly 2 GET /chats (bootstrap + CDM), at most
   2 getToken per chat, exactly 1 WS connection per chat; SPA navigation to
   /messenger → 1 GET /chats; /assistant entry loads its AI chat list.

Verification: `npm run verify` (all green), `node
.claude/hooks/scripts/guard-architecture.mjs --all --strict`, live rows.
