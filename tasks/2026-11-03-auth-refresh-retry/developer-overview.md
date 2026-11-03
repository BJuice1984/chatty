# Developer overview — 2026-11-03-auth-refresh-retry

## Intent and user-visible result

The access cookie lives 15 minutes; the refresh cookie 7 days. Today, when
the access cookie expires mid-session, every messenger request silently fails
with a 401 until the user reloads the page (and only the cold-boot `/auth/me`
path knows how to refresh). When the backend answers 5xx, the request just
fails.

After this run:

- Any request except the five semantic auth endpoints (`/auth/refresh`,
  `/auth/login`, `/auth/register`, `/auth/logout`, `/auth/logout-all`) that
  receives 401 triggers ONE shared `POST /auth/refresh`; on success the
  ORIGINAL request is replayed once with the fresh cookies and its caller
  sees a normal response. `/auth/me`, `/auth/profile` and `/auth/password`
  ARE healed like everything else (the profile feature rides the `/auth`
  prefix — review F-3). While the refresh is in flight the screen dims with a
  spinner and «Пожалуйста, ожидайте» plus three animated dots.
- If refresh fails (expired/rotated/absent refresh cookie, network death),
  the session is cleared locally (`setUser(null)`), a best-effort
  `POST /auth/logout` fires, and the user is redirected to the sign-in page —
  "kicked out of the chat".
- Any request except those five endpoints that receives a 5xx response is
  retried up to 3 more times with 2s/6s/12s pauses (ALL methods — operator
  decision; note the accepted risk that a POST whose server-side commit
  succeeded before the 500 may duplicate on replay). During retries the
  overlay shows the spinner and «Возможно, проблемы на сервере.. Мы
  пробуем переподключиться».
- The overlay is refcounted across PARALLEL intercepted requests: it stays up
  until the last one settles; the caption follows the most recent kind.

## Architecture boundaries

- Layers only downward (`pages → components → controllers → api → utils`).
  `HTTPTransport` (utils) learns the `TransportPolicy` INTERFACE only — it
  never imports features, Store or Router. The implementation of the policy
  lives in `features/auth/transportPolicy.ts` (imports down: auth api port,
  `utils/csrf`, `utils/Router`, `utils/busyOverlay`). Binding is a consumer
  side seam in `features/index.ts` (same pattern as `setProfileSeams`).
- `utils/busyOverlay.ts` is an imperative lazy DOM module (creates its node
  on first `show`), no Block component, no registration in `components.ts`,
  no `main.ts` change. SCSS ships via `src/scss/components/_all.scss`.
- `meWithRefresh` in `features/auth/api/own.ts` is REMOVED as dead code:
  `/auth/me` is intercepted by the global policy like every other request,
  so a single refresh mechanism serves both cold boot and runtime (review
  F-3). The five excluded endpoints are exactly those whose 401/403 answers
  are semantic (login/register) or recursive (refresh) or terminal
  (logout/logout-all).
- The WS transport, bot-run network/timeout retry in `chats/controller.ts`,
  and the WS-notification flow are untouched.

## Key mechanics the workers must honor

1. Single-flight refresh is mandatory: rotation is one-shot
   (`token_version` bump). Two parallel refreshes would guarantee
   `refresh_token_rotated` and an unwanted kick-out. The shared promise must
   be created once and cleared in `finally`. On top of it a 2000ms
   RECENTLY-REFRESHED WINDOW absorbs the stale-401 race (review F-8): a 401
   arriving just after a completed rotation replays immediately (`true`, no
   network) instead of firing a second rotation that would fail with
   `refresh_token_rotated` and wrongly kick the user out.
2. The 401 replay happens at most ONCE per request (a replayed request that
   401s again rejects). A 401 replay that then answers 5xx still enters the
   500-retry branch, and vice versa; the 500 budget is 3 retries per request
   in total.
3. `onUnauthorized` rejections are swallowed and treated as `false` (the
   caller sees the ORIGINAL 401 error, never the refresh internals).
4. Before the replay, `beforeUnauthorizedRetry` re-reads the csrf cookie —
   rotation reissued `chatty_csrf`, and a non-GET replay with the stale
   token would 403.
5. Absent csrf cookie ⇒ `onUnauthorized` returns `false` immediately without
   any network call (a signed-out browser fires no useless refresh).
6. The overlay has EXACTLY ONE driver (review F-2): the policy's
   `onRetryOverlay` maps balanced transport events to
   `showBusyOverlay`/`hideBusyOverlay` — `onUnauthorized` never touches the
   overlay. The transport emits `begin(kind)`/`end` as a BALANCED PAIR PER
   INTERCEPTION PHASE (review F-1): every begin is paired with exactly one
   end on every terminal path (success, false, hook rejection, 5xx
   exhaustion, 401→500 composition). The policy's show is DEFERRED by a
   macrotask and cancelled when the paired end arrives first (no flash for
   instantly-resolved interceptions); `busyOverlay`'s teardown at refcount
   zero is grace-deferred and cancelled by the next show (no flash on the
   401→5xx phase transition).
7. Every test suite that installs a policy resets it via
   `HTTPTransport.setTransportPolicy(null)` in `afterEach` — the policy is
   static global state and mocha orders `src/features/**` before
   `src/utils/**` in one process (review F-4).
8. Overlay captions are VERBATIM operator copy: wait kind renders
   «Пожалуйста, ожидайте» followed by three animated dot spans; reconnect
   kind renders «Возможно, проблемы на сервере.. Мы пробуем переподключиться»
   (including the «..» and the space). No re-punctuation.
9. No comments in new/edited SCSS; TS imports carry `.ts`; eslint/stylelint
   style is enforced by fixers before commit.

## Risks

- Stale-401 race (bounded): a slow request sent with the pre-rotation access
  token can 401 just after the shared refresh cleared; without the
  recently-refreshed window a second rotation would retire the fresh access
  token and kick the user out. The 2000ms window (mechanic 1) contains it;
  the residual outcome is a one-off failed request, never a wrongful
  kick-out.
- Cold-boot behavior changes from the meWithRefresh removal (both verified
  safe, both worth knowing): (1) a dead/rotated refresh at boot now runs the
  full kick-out path (setUser(null) + best-effort logout + Router.go(SIGNIN))
  before Router.start() — safe because routes and guards are registered at
  main.ts module scope and go() is pushState + _onRoute, independent of
  start(); (2) a 5xx on /auth/me at boot is retried under the overlay for up
  to ~20s before fetchUser's catch runs, delaying the login redirect on a
  broken backend — consistent with the operator's global retry decision.

- POST duplication on a 500-after-commit replay — accepted by the operator
  (all-method retry). Bot runs stay safe: `bot_runs.message_id` is unique and
  a replay returns the same run; a bot 500 now retries globally, which can
  hold the overlay through long retries — bounded by the 3-retry budget.
- Parallel mixed kinds (one request refreshing, another 500-retrying) show
  the most recent caption; acceptable, single overlay by design.
- `docs/progress/progress_log.md` is also written by the parallel ui-ux
  branch; this plan writes its entry on top of the dev base — expected
  textual proximity at merge time, both are append-on-top records.

## Non-goals

- No preemptive/proactive refresh timer; refresh stays reactive on 401.
- No WS-connection changes (bounded reconnect stays as is).
- No auth store shape or guard behavior changes (`meWithRefresh` is removed
  as dead code — its behavior is subsumed by the global policy).
- No backend code changes: the backend already implements the contract; this
  run only pins it with integration tests (a discovered defect would be a
  plan gap routed to the controller, not a silent code edit).
- No overlay on the login/register surfaces, no i18n layer.

## Execution model

Three packets, dependency DAG: `WS-BE-REFRESH-TESTS` and `WS-FE-TRANSPORT`
are independent; `WS-FE-AUTH-POLICY` depends on `WS-FE-TRANSPORT` (consumes
the frozen `TransportPolicy` interface). maxParallelTasks 1 — one worker at a
time, controller-run. Evidence per workstream under
`work/2026-11-03-auth-refresh-retry/evidence/<WS>/`. Frontend gate
`npm run verify`; backend gate `PYTHON_BIN=~/.venvs/chatty-backend/bin/python
npm run verify:backend`; architecture guard strict stays 0; final
`npm run verify:all`.
