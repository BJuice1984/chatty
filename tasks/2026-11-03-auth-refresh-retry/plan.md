# Plan 2026-11-03-auth-refresh-retry

Operator request (verbatim intent): on a stale access token, transparently
refresh and replay the originally failed request; if refresh fails, kick the
user out of the chat to the login screen; while this happens show a full-screen
dimming overlay with a spinner and the text «Пожалуйста, ожидайте...» with
three animated dots; on a 500 response, retry the request with the same overlay
showing «Возможно, проблемы на сервере.. Мы пробуем переподключиться». Check
both frontend and backend. Run through the ALK plugin.

Clarified operator decisions (2026-11-03): 500-retry applies to ALL HTTP
methods; retry schedule is 3 retries with 2s/6s/12s pauses.

## What exists today

- Backend already implements the full refresh contract:
  `POST /api/v1/auth/refresh` (CSRF double-submit, one-shot refresh-token
  rotation via `token_version` bump, reissues access/refresh/csrf cookies);
  access cookie TTL 15 min, refresh 7 days; `get_current_user` answers 401
  `authentication_required` / `invalid_token` / `token_version_stale` on every
  protected route. No integration tests cover the refresh endpoint today.
- Frontend uses refresh in exactly ONE place: `meWithRefresh` in
  `features/auth/api/own.ts` (cold boot of `/auth/me`). Every other request
  that hits an expired access cookie simply rejects with a 401 TransportError.
  There is no global 401/500 interception and no busy overlay.

## Design (one paragraph)

`HTTPTransport` (utils, layer-bottom) stays framework-free and gains an
injectable `TransportPolicy` with four optional hooks — `onUnauthorized(url)`
(single-flight refresh, resolves `true` to replay the request once),
`onServerErrorDelay(url, attempt)` (pure delay lookup: 2000/6000/12000 or
`null`), `onRetryOverlay(phase, kind)` (balanced begin/end pairs per
interception phase) and `beforeUnauthorizedRetry(options)` (re-reads the
fresh csrf cookie before the replay). Only the five semantic auth endpoints
(`/auth/refresh`, `/auth/login`, `/auth/register`, `/auth/logout`,
`/auth/logout-all`) are never intercepted — `/auth/me`, `/auth/profile` and
`/auth/password` ARE healed (the profile feature rides the same prefix), so
the cold-boot `meWithRefresh` becomes dead code and is removed: one refresh
mechanism for boot and runtime. The policy implementation lives in
`features/auth/transportPolicy.ts`: a 2000ms recently-refreshed window
(absorbs the stale-401 race after a completed rotation), one shared refresh
promise (rotation is one-shot — two parallel refreshes would log the user
out), a fast `false` when the csrf cookie is absent (no network), local
logout (`setUser(null)` + best-effort `POST /auth/logout` +
`Router.go(SIGNIN)`) when refresh fails, and the sole overlay wiring
(deferred show cancelled by an instantly paired end — no flash). The overlay
itself is a tiny imperative DOM module `utils/busyOverlay.ts` +
`busy-overlay.scss` (spinner ring, dimming, refcounted show/hide with
grace-deferred teardown, kind-switchable caption with three animated dot
spans). Binding happens in `features/index.ts` via `installAuthTransportPolicy()`
next to the other consumer-side seams. Backend work is a new integration
test module pinning the whole refresh contract; no backend code change is
planned.

## Workstreams

1. `WS-BE-REFRESH-TESTS` — integration tests pinning the refresh contract
   (rotation kills the old refresh cookie, csrf enforcement, 401 details on
   protected routes, access-cookie invalid variants, logout kills refresh).
2. `WS-FE-TRANSPORT` — `TransportPolicy` in `HTTPTransport` (401 replay once,
   500 retry ×3 with 2/6/12s; only the five semantic auth endpoints —
   refresh/login/register/logout/logout-all — are excluded, `/auth/me`,
   `/auth/profile` and `/auth/password` ARE healed), balanced overlay
   begin/end pairs per interception phase, `utils/busyOverlay.ts` + scss
   (verbatim captions, animated dots, grace teardown), unit tests for both.
3. `WS-FE-AUTH-POLICY` (depends on 2 and 1) — `features/auth/transportPolicy.ts`
   (single-flight refresh + 2000ms race window, failed-refresh kick-out, csrf
   re-read, deferred overlay wiring, `installAuthTransportPolicy`), removal of
   the dead `meWithRefresh`, binding in `features/index.ts`, unit tests,
   progress log.

## Validation

- `npm run verify` (mocha base 568 grows), `PYTHON_BIN=~/.venvs/chatty-backend/bin/python npm run verify:backend` (pytest base 253 grows),
  `node .claude/hooks/scripts/guard-architecture.mjs --all --strict` (0),
  final `npm run verify:all`.

## Branch

`feature/2026-11-03-auth-refresh-retry` from `dev` @ 7dbd7aa; PR target `dev`.
