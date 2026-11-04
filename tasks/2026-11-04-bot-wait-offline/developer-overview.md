# Developer overview — 2026-11-04-bot-wait-offline

## Intent and user-visible result

Live symptoms this run removes (recorded in `docs/NEXT.md` by `4edbd99`):

1. Sending a message in a big chat takes seconds before YOUR OWN message
   appears. The feed re-renders wholesale several times per store emit, every
   message block is re-constructed each render, and every ChatPage re-render
   leaks another store-subscribed Messenger/ChatHistory that also re-renders on
   every emit — the cost compounds over the session.
2. During a long bot run the UI stands on a static «Ассистент печатает…»
   placeholder for 30–40s because the model's answer is delivered only whole.
3. If the browser goes offline (DevTools Offline, Wi-Fi drop) the app never
   notices the network coming back: the WS transports exhaust their bounded
   reconnect budget and stay dead until F5; nothing resyncs the feed.

After this run:

- One store emit → one render per component (not one per changed prop key);
  unchanged messages reuse their component instances (no O(n) re-construct);
  abandoned withStore children are destroyed and unsubscribed, so the render
  cost stops growing over the session. Own-message appearance drops from
  seconds to well under the 500ms debt-note target (live number recorded in
  the progress log; the offline-while-idle and own-message checks run against
  the local compose stack, no inference host needed).
- While the bot generates, the pending bubble shows a CSS typing animation and
  then the answer text STREAMS into it chunk by chunk over the existing chat
  WS (`bot_delta` events); the final message replaces the placeholder exactly
  as today (dedup/REST-fallback paths untouched). With the inference host
  DOWN, this is pinned end-to-end by fakes (fake SSE provider, fake hub,
  adapter tests); the live first-token < 3s check is DEFERRED acceptance.
- On `window offline` a full-screen «Возможно, проблемы на сервере.. Мы
  пробуем переподключиться» overlay appears; on `online` it hides, stuck WS
  backoffs are force-dropped (chats AND stories), all chats reconnect and
  resync their tails (existing Connected-resync). NO auth warm-up ships
  (dropped, review F-4): a stale access cookie is healed reactively by the
  global 401→refresh policy and the 2000ms recently-refreshed anti-kickout
  guard stays intact — `features/auth` is untouched. A WS that dies from
  exhausted reconnects while online shows the same indicator (intent
  marks distinguish it from intentional closes, review F-3) until a socket
  reconnects.

## Architecture boundaries

- Layers only downward. `src/core` (Block, registerComponent) learns three
  GENERIC mechanics — batched setProps emit, destroy-replaced-hbs-children
  with the retained exemption, opt-in `cacheKey` instance reuse — with ZERO
  messenger/bot knowledge. The messenger feature opts into the cache
  (`cacheKey` per mapped message) and owns pruning to the current feed. Guard
  strict stays 0.
- `WS-FE-RESILIENCE` orchestration lives in
  `src/features/chats/ws/connectivity.ts` (same feature as the adapter;
  stories controller is `features/chats/stories` — inside the same chats
  feature tree). The composition root `src/features/index.ts` binds the
  watcher. Connectivity NEVER touches `features/auth` (forbidden write — no
  warm-up, review F-4); a stale access cookie heals through the existing
  global transport policy.
- Backend: the `BotProvider` protocol gains `complete_stream` implemented
  EXPLICITLY on BOTH providers — `OllamaBotProvider` answers ONE chunk from
  `complete()` (structural implementers do not inherit Protocol defaults,
  review N-1) and only `OpenAIChatProvider` streams; the protocol default
  remains for fakes that subclass. The delta bridge is built in the ENDPOINT
  (it owns the running event loop and the hub) and handed to the service as
  an `on_delta(text)` callback — the service stays loop-agnostic and
  throttles (~250ms) before calling it. `hub.broadcast` is reused as-is
  (membership filtering inherited by `bot_delta`).
- The final answer message path (message creation, single broadcast on NEW
  success, redelivery skip, `response_message_id`, REST fallback) is
  byte-identical — deltas are pure progress UI.

## Key mechanics the workers must honor

1. **setProps batching**: assign into the RAW props target (bypass the proxy
   set trap), then emit `FLOW_CDU` ONCE with old/new snapshots. External
   writes through the proxy (if any legacy code assigns `this.props.x =
   …`) keep the per-key emit — only `setProps` batches. CDM/CDU semantics and
   their order are unchanged; test suites that counted renders per setProps
   update inside the write-set.
2. **destroy-replaced-hbs-children with the RETAINED exemption**: `compile()`
   compares the OLD `_hbsChildren` list with the NEW one by instance
   reference and destroys only the absent ones; `Block.destroy()` likewise
   skips retained instances. A cache-retained instance (mechanic 3) is marked
   at registration and is NEVER destroyed by a parent — the feature cache
   owns its lifetime via the prune. Without the exemption the leak fix itself
   would destroy the cached Message instances the NEW render just reused and
   gut the feed (review F-2 — this is a mainline path, not an edge; pinned by
   the destroy-survival test).
3. **cacheKey reuse**: `registerComponent`'s helper accepts `cacheKey` in the
   hash; on hit it `setProps`-refreshes the cached instance instead of
   constructing one; the embed moves the instance's existing element into the
   new render. The messenger mapper supplies `cacheKey` (`id:<n>` for real
   messages, the FIXED `pending:tail` for the at-most-one placeholder per
   feed) and prunes the cache to the current feed's keys (chat switch /
   message removal drops the stale entries — no unbounded growth). Instances
   whose key leaves the feed are destroyed by the prune.
4. **pending_for linkage + bot_delta contract**: the placeholder entry gains
   ONE optional field `pending_for` (the question message id), written by its
   ONLY creator (`runBotForLastOwnMessage`'s placeholder append) — the single
   store-shape change of the plan, owned by the same workstream as the
   consumer (review F-1). Contract: `{'type': 'bot_delta', 'content':
   {'message_id': <question message id>, 'delta': <str>}}` broadcast to the
   chat room. The adapter appends `delta` to the pending tail ONLY when the
   tail's `pending_for` EQUALS `content.message_id`; otherwise the delta is
   dropped silently — no foreign or replayed text can enter the feed (final
   message delivery replaces the placeholder through the existing path).
   Known limitation (review N-3): other members' tabs have no pending tail —
   they see only the final message; run-scoped placeholders are a follow-up.
5. **Throttling and thread safety**: the service coalesces deltas with a
   ~250ms window (tail flush unnecessary — the final message carries the full
   text); the endpoint bridge uses `asyncio.run_coroutine_threadsafe` onto
   the request's loop and never blocks or raises into the worker thread
   (bridge failures are swallowed and logged). A failed/cancelled provider
   stream fails the run through the existing `fail(kind)` path — no partial
   answer message is ever created. BOTH providers implement `complete_stream`
   explicitly (ollama = one chunk; structural implementers do not inherit
   Protocol defaults — review N-1).
6. **Thinking knob defaults preserve behavior**: `CHATTY_BOT_ENABLE_THINKING`
   defaults to `true` (current behavior); the operator sets it to `false` in
   the deployment env for the fast-first-token UX. `CHATTY_BOT_STREAMING`
   defaults to `true`; setting it to `false` falls back to the whole-answer
   `complete()` path (kill-switch against a misbehaving llama-server stream).
   Both land in `backend/.env.example` and `docs/deployment/own-backend.md`,
   together with the recommendation to drop the operator
   `CHATTY_BOT_TIMEOUT_SECONDS` from 300 to ~60 once streaming is on
   (per-chunk read timeout) — the code default (60) does not change.
7. **Offline watcher, NO warm-up**: listeners bind ONCE at the composition
   root (idempotent install); `offline` → `showBusyOverlay('reconnect')`;
   `online` → `hideBusyOverlay()` + force-drop non-OPEN chat sockets
   (`reconnectAllChatSockets`) + `reconnectStoriesSocket()` (stories
   symmetry, review F-7 — the `socket !== null` guard otherwise silently
   skips a socket stuck mid-backoff) + `fetchChats()` (existing
   Connected-resync). There is NO auth warm-up (review F-4 — dropped): the
   global 401→refresh policy already heals a stale access reactively and the
   2000ms recently-refreshed anti-kickout guard must stay intact;
   `features/auth` is a forbidden write. `navigator.onLine === false` at
   bind time does not fire the online path.
8. **Intent-differentiated WS-death indicator** (review F-3): WSTransport
   emits the SAME payload-free Close for manual `close()` and for exhaustion
   — the ADAPTER differentiates: every intentional close path (`closeChat`,
   `chat_deleted`, `leaveChat`, `closeAll`, `reconnectAll` drops) marks the
   chat id BEFORE `socket.close()`; the Close handler notifies the watcher
   ONLY for unmarked (exhausted) closes, and a subsequent Connected hides
   the indicator. Negative pins: intentional closes produce NO indicator.
9. **Deferred live acceptance** (host down): first-token < 3s,
   thinking-knob effect on the real llama-server, offline-during-bot-answer
   end-to-end — recorded as deferred in `docs/NEXT.md` with an operator
   note; the gates themselves never depend on the inference host. Base
   counts (review F-5): mocha 623; the backend gate runs in the Windows form
   (baseline 259 passed + 4 known ingestion failures, 263 collected) or the
   canonical `PYTHON_BIN` form — zero NEW failures is the bar.

## Risks

- Core `Block` changes ripple across every UI surface: full `npm run verify`
  after each mechanic lands; render-count-sensitive tests are updated inside
  the write-set, never deleted to pass.
- The instance cache is the sharpest edge: a wrong prune set either leaks
  instances (bounded by feed size, cosmetic) or destroys a live instance
  (visible breakage) — pinned by tests for chat switch, message removal and
  pending→final replacement.
- The thread→loop bridge can reorder against the final broadcast if the last
  delta races the completion; harmless by design (the final message replaces
  the tail) — tests pin that no delta arrives AFTER the final message is
  applied by dropping deltas without a pending tail.
- Streaming over SSE against llama-server is validated ONLY by fakes in this
  run (host unavailable): shape drift between our SSE parser and the real
  server is a residual risk covered by the kill-switch env and the deferred
  live smoke.
- `docs/NEXT.md` and `docs/progress/progress_log.md` are append-on-top
  records shared with parallel work; expected textual proximity at merge.

## Non-goals

- No Store API change beyond the single optional `pending_for` placeholder
  field (no `setMany`/coalescing; the JSON-snapshot compare stays — after
  batching the 2-emits-per-message cost is O(changed) and acceptable for feed
  sizes in play).
- No GET/polling endpoint for bot runs (lost broadcasts stay covered by the
  idempotent POST retry + REST tail fetch).
- No list virtualization/windowing of the feed (the residual O(n)-per-emit
  re-render is documented, review N-2).
- No streaming for the `/assistant` REST loop (ai-assistant page) — the
  messenger chat WS path only; no run-scoped placeholders for OTHER members'
  tabs (they see the final message — review N-3 limitation).
- No pgvector/RAG changes (python cosine stays; sub-second on the current
  corpus).
- NO auth warm-up or proactive refresh on `online` (dropped, review F-4);
  `features/auth` is a forbidden write.
- No WSTransport backoff/ceiling/payload changes (adapter drop-and-reopen +
  intent marks instead).
- No i18n; verbatim UI copy preserved («Ассистент печатает…» stays the
  a11y/visual base of the pending bubble).

## Execution model

Three packets, DAG: `WS-FE-RENDER-PERF` and `WS-BE-BOT-STREAM` are
independent (disjoint write-sets); `WS-FE-RESILIENCE` depends on
`WS-BE-BOT-STREAM` (it consumes the frozen `bot_delta` event contract pinned
by the backend tests) and owns the WHOLE frontend beyond core in one
write-set — the connectivity watcher, chats+stories force-reconnect, the
intent-differentiated indicator, the `pending_for` linkage with the
`bot_delta` dispatch, the honest echo error, the typing animation and the
run records (review F-1: the linkage field and its consumer share one
owner, so no wave improvises the matching). maxParallelTasks 1 — one worker
at a time, controller-run, evidence per workstream under
`work/2026-11-04-bot-wait-offline/evidence/<WS>/`. Frontend gate `npm run
verify` (mocha base 623); backend gate in the Windows form
(`PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe bash
backend/verify.sh`, baseline 259 passed + 4 known ingestion failures) or the
canonical form; guard strict stays 0; final `npm run verify:all`.
