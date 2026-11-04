# Plan 2026-11-04-bot-wait-offline

Operator request (verbatim intent): close the two tech-debt items recorded in
`docs/NEXT.md` by commit `4edbd99` on this branch, born from live operation of
the AI messenger. Item 1 «производительность и UX ожидания бота»: own message
takes seconds to appear (candidate — feed re-renders on every store emit), a
timeout error pops on a live long `POST /bot/runs` (200 arrives later), and the
UI stands on a static placeholder for 30–40s because the answer is delivered
only whole (no streaming; Qwen3.5-9B thinks before answering). Acceptance from
the debt note: own message < 500ms, first answer token < 3s. Item 2
«браузерный offline/online»: nobody listens to `window` `offline`/`online` or
`navigator.onLine`; `WSTransport` exhausts its bounded reconnect budget during
a long offline and stays dead until F5. Acceptance: DevTools Offline 30s+ →
network back → the feed catches up without reload, WS `readyState` open.

Clarified operator decisions (2026-11-04): both items in one run; the run
CONTINUES on branch `feature/2026-11-03-auth-refresh-retry` (deliberate
deviation from the `feature/<plan-id>` convention — the debt builds directly on
this branch's bot retry/overlay code and its PR is not merged yet; one PR to
`dev` carries both); full ALK lifecycle. **Constraint (operator, 2026-11-04):
the llama-server inference host is currently UNAVAILABLE — all streaming
evidence is mock/fake-provider based; live smoke against the real model (first
token < 3s, thinking-knob effect, offline-during-bot-answer) is recorded as
DEFERRED acceptance in `docs/NEXT.md` and runs when the host returns.** The
offline-while-idle scenario is checkable against the local compose stack
without the inference host. Review-driven decisions (round 1, NEEDS_REVISION):
the auth warm-up is DROPPED (F-4 — the global 401→refresh policy already
heals a stale access after offline; a race-window reset is a no-op after 30s+
offline and would remove the anti-kickout guard after a short post-refresh
flap); the pending placeholder gains ONE optional creator-written field
`pending_for` owned by the same workstream as the bot_delta consumer (F-1);
cache-retained children are exempt from Block.destroy()/compile sweeps (F-2);
the WS-death indicator differentiates intent via adapter-side marks — the
payload-free Close event and WSTransport stay untouched (F-3); base counts
corrected to mocha 623 / pytest Windows 259+4 known (F-5) and the backend
gate gained its Windows form (F-6); stories sockets get the same force-drop
as chats (F-7).

## What exists today (recon 2026-11-04, verified on this branch)

- **Render**: `Block.setProps` `Object.assign`s through the props proxy whose
  set trap emits `FLOW_CDU` PER KEY synchronously and `componentDidUpdate`
  always returns true — a `withStore` mapper spread of ~5–8 props causes 5–8
  FULL re-renders (template compile + `replaceWith` of the whole root) per one
  store emit per component. `registerComponent`'s helper runs `new
  Component(hash)` on every call, and `messenger.hbs` iterates `{{#each
  messages}}` without keys — every Message block of the feed is re-constructed
  on every render. Worse, `Block.compile` REPLACES `this._hbsChildren` without
  destroying the old ones: every ChatPage re-render creates a NEW Messenger
  (a `withStore` wrapper) whose store subscription is never removed
  (`destroy()` is never called on the abandoned instance — acknowledged by the
  comment at `chat.ts:12-16`), so each store emit re-renders every Messenger
  and ChatHistory instance ever created this session. One own message in a
  regular chat costs 2 store emits (messages + chats); an AI question→answer
  costs 6–8. `Store.set` compares JSON snapshots per call (O(n) per set) and
  `withStore`'s `shallowEqual` always sees a fresh `messages` array reference.
- **Bot run**: `runBot` POSTs `/{chatId}/bot/runs` with XHR timeout 300s;
  network/timeout `TransportError`s retry at [0, 5s, 15s] in
  `runBotWithNetworkRetry` (idempotency by `message_id`), 5xx retries globally
  at 2/6/12s; lost WS broadcasts are healed by `ensureBotAnswerDelivered`
  (REST tail fetch by `response_message_id`). `waitForOwnEcho` silently skips
  the bot run when the WS echo of the question does not arrive within 5s. The
  wait indicator is a static isPending tail in the store.
- **Backend**: `OpenAIChatProvider` posts `/v1/chat/completions` with
  `'stream': False` hardcoded and reads the whole `choices[0].message.content`;
  no thinking control anywhere; the run executes in `asyncio.to_thread` inside
  the request (durable — the thread plays out even if the browser drops the
  channel); the answer message is broadcast ONCE from the endpoint after a NEW
  success (`endpoints/bot.py:78-86`; redelivery skips broadcast); the chat WS
  hub filters by membership and speaks `{'type', 'content'}`.
  `CHATTY_BOT_TIMEOUT_SECONDS` (operator env 300) covers ALL httpx timeouts —
  with streaming it becomes per-chunk and can honestly drop.
- **WS/offline**: `WSTransport` reconnects 1→2→4→8→16s with a 5-attempt
  ceiling, then rejects + emits Close and the adapter FORGETS the chat
  (`sockets.delete`); a repeated `connect()` fully revives a transport, but
  the per-chat `connect` guard `sockets.has(id)` cannot kick a chat that is
  still cycling its backoff. On `Connected` the adapter ALREADY resyncs the
  tail (history request `before_id: null, limit: 50` → dedup append +
  cursor re-init). Sockets for every chat of the list are opened by
  `ChatsController.fetchChats` (token → connect); the stories socket is one
  per app. busyOverlay (`utils/busyOverlay.ts`) exposes refcounted
  `showBusyOverlay('wait'|'reconnect')` / `hideBusyOverlay()`. No
  offline/online listeners exist anywhere in `src/`.

## Design (one paragraph)

Three workstreams. **WS-FE-RENDER-PERF** fixes the render economics at the
core: `Block.setProps` assigns into the RAW props object (bypassing the
per-key proxy trap) and emits ONE `FLOW_CDU` per call with before/after
snapshots (lifecycle semantics unchanged — only the per-call emit count drops
from N-keys to 1); `Block.compile` destroys the replaced `_hbsChildren`
entries that are absent from the new render's list (by instance reference)
EXCEPT cache-retained instances — and `Block.destroy()` likewise skips them —
which ends the abandoned-Messenger/ChatHistory subscription leak without
gutting the shared cached children (the feature cache owns their lifetime via
the prune, review F-2); `registerComponent` gains OPT-IN keyed instance
reuse — a `cacheKey` in the hash reuses a live instance across renders
(`setProps` refresh instead of `new`), with a module cache pruned by the
caller feature (messenger mapper passes `cacheKey` per message: `id:<n>`,
the FIXED `pending:tail` for the at-most-one placeholder per feed — no
question-id coupling in this workstream, review F-1), so unchanged messages
stop being re-constructed and re-mounted. **WS-BE-BOT-STREAM** adds streaming
to the provider behind the `BotProvider` protocol (`complete_stream`
implemented EXPLICITLY on BOTH providers — ollama answers ONE chunk from
`complete()`, structural implementers do not inherit Protocol defaults,
review N-1): `OpenAIChatProvider` streams SSE and yields
`choices[0].delta.content` (reasoning/thinking deltas excluded), a new
`CHATTY_BOT_ENABLE_THINKING` env (default `true` — behavior preserved) adds
`chat_template_kwargs: {'enable_thinking': false}` when disabled, and
`CHATTY_BOT_STREAMING` (default `true`) is the operator kill-switch;
`BotService` throttles deltas (~250ms) onto a bridge built by the endpoint
(`asyncio.run_coroutine_threadsafe` onto the request's event loop →
`hub.broadcast(chat_id, {'type': 'bot_delta', 'content': {'message_id':
<question id>, 'delta': <text>}})` — membership filtering inherited); the
final answer message, its broadcast and the idempotent redelivery stay
byte-identical, so the REST fallback and dedup paths are untouched.
**WS-FE-RESILIENCE** owns the whole frontend beyond core: the pending
placeholder gains ONE optional creator-written field `pending_for` (the
question message id — the single store-shape change, living in the SAME
workstream as its consumer, review F-1) and the WS adapter appends
`bot_delta` text to the tail ONLY when `pending_for` equals the event's
`message_id` (single batched store emit per delta; every other delta is
DROPPED — no foreign text can enter the feed); a connectivity watcher binds
at the composition root with NO auth warm-up (dropped, review F-4 — the
global 401→refresh policy already heals a stale access; `features/auth` is a
forbidden write): on `window offline` → `showBusyOverlay('reconnect')`; on
`online` → hide, force-drop chat sockets that are not OPEN (new
`reconnectAllChatSockets()` — the `sockets.has` guard makes stuck-backoff
chats otherwise unkickable) so the following `fetchChats()` reopens
everything with the existing Connected-resync, plus `reconnectStoriesSocket()`
(stories symmetry, review F-7); the WS-death indicator differentiates intent
by ADAPTER marks set before `socket.close()` on every intentional path —
only unmarked exhaustion closes show it and a Connected hides it (review
F-3); the pending bubble gains a pure-CSS typing animation until the first
delta (no store ticks), the final message replaces the placeholder exactly
as today, and `waitForOwnEcho`'s 5s silent skip becomes an honest
user-visible error. Everything is pinned by mocha/pytest with fake providers
and fake hubs — no inference host needed for the gates.

## Workstreams

1. `WS-FE-RENDER-PERF` — core render economics: one-emit `setProps`,
   destroy-replaced-hbs-children WITH the retained exemption (review F-2),
   opt-in `cacheKey` instance reuse in `registerComponent` (placeholder keyed
   by the FIXED `pending:tail`), messenger mapper/template wiring, tests.
2. `WS-BE-BOT-STREAM` — provider `complete_stream` (explicit on BOTH
   providers, review N-1) + SSE parsing + thinking kwarg + streaming
   kill-switch, service delta throttle, endpoint→hub bridge,
   `.env.example`/deployment docs (incl. the forgotten `CHATTY_BOT_RAG_MIN_SCORE`),
   pytest with fakes; live smoke DEFERRED (host down).
3. `WS-FE-RESILIENCE` (depends on 2 for the frozen `bot_delta` contract) —
   the WHOLE frontend beyond core in one owner (review F-1 — the pending
   placeholder gains `pending_for` (question message id) from its only
   creator, and the linkage lives with its consumer): offline/online watcher
   WITHOUT an auth warm-up (dropped, review F-4), chats AND stories
   force-reconnect (review F-7), intent-differentiated WS-death indicator
   (adapter intent marks, review F-3), `bot_delta` dispatch matched by
   `pending_for`, honest `waitForOwnEcho` error, CSS typing animation,
   progress log + `docs/NEXT.md` closure records.

## Validation

- `npm run verify` (mocha base **623** grows, review F-5); backend gate —
  Windows form `PYTHON_BIN=~/.venvs/chatty-backend/Scripts/python.exe bash
  backend/verify.sh` (baseline 259 passed + 4 known ingestion failures, 263
  collected — zero NEW failures, review F-6) or the canonical
  `PYTHON_BIN=~/.venvs/chatty-backend/bin/python npm run verify:backend`;
  `node .claude/hooks/scripts/guard-architecture.mjs --all --strict` (0),
  final `npm run verify:all`.
- Deferred (operator, host-dependent): live first-token < 3s, thinking-knob
  effect on the real llama-server, offline-during-bot-answer end-to-end;
  locally checkable without the host: offline-while-idle recovery against the
  compose stack and the own-message timing measurement.

## Branch

`feature/2026-11-03-auth-refresh-retry` @ `4edbd99` (operator decision:
continue on this branch, one PR to `dev` for the whole contour).
