# Specification — 2026-11-07-auth-session-ux (S2)

## Intent

Close three live-session UX/robustness defects reported by the operator on
2026-11-07 after a full password rotation and an api-container recreation:

1. **Logout is impossible when the request carries a duplicate `chatty_csrf`
   cookie.** Live repro (curl against the running compose stack): a request
   whose transport carries TWO Cookie header entries — a stale path-scoped
   copy of `chatty_csrf` first, the fresh copy second — gets `403
   csrf_failed` even when the `X-CSRF-Token` header matches the fresh
   (document.cookie-visible) value. Root cause (verified on the pinned
   starlette 0.48.0): `require_csrf` reads `request.cookies.get(...)`;
   Starlette's `Request.cookies` parses only the FIRST raw Cookie header
   (`headers.get('cookie')`), and WITHIN a single header the LAST duplicate
   name wins (dict assignment). Either arrangement can shadow the fresh
   copy. The user is locked out of logout with no in-app remedy.
2. **Successful login shows the auth form through the whole request round
   trip.** `AuthController.signin` awaits `port.signin` + `fetchUser` before
   `Router.go(MESSENGER)`; the form stays interactive-looking and idle for
   the whole flight, then the screen flips. Operator asks for a loading
   state.
3. **A failed login/registration wipes the typed credentials.** Setting
   `authError` in the store re-renders the page; `Form`/`LabeledInput` are
   recreated from scratch (registerComponent constructs new instances per
   compile) and the input `value` lived only in the DOM — it dies with the
   old nodes. Operator asks: keep typed values, show the error only.

## Product behavior

- **CSRF**: `require_csrf` accepts the request when the submitted header
  matches ANY `chatty_csrf` copy present across ALL Cookie headers
  (duplicates are legitimate browser history — e.g. a stale path-scoped
  copy shadowing the fresh one). A header matching NO copy, a missing
  header, or a missing cookie still fails with `403 csrf_failed`.
  Comparison stays constant-time per copy (`hmac.compare_digest`). The
  origin allowlist check inside `require_csrf` is unchanged. The
  regression tests are RED-GREEN pinned: both duplicate arrangements
  (two header entries stale-first; single header fresh-first-then-stale)
  fail on the unpatched check and pass after it.
- **Login/registration loading**: while signin/signup is in flight the
  primary submit button is disabled and relabels to an in-flight label
  (`Signing in…` / `Signing up…`); an Enter-initiated submit during the
  flight is ignored (guard in the submit handler, not only the disabled
  button). When the request settles (success or any error), the button
  returns to its normal state. The screen does not flip to the messenger
  before the user is fetched — the transition itself is unchanged.
- **Value preservation**: any re-render of the login/register pages caused
  by store updates (authError appearing/clearing, authLoading toggling)
  preserves the current text of every form input; only an explicit page
  remount (navigation) starts clean.

## Boundaries

- No change to the cookie contract itself (names, paths, `set_auth_cookies`
  stays byte-identical); no new envs; no migration.
- `src/utils/Store.ts` gains ONLY the optional `authLoading` field on
  `AppState`/`ComponentProps`; no Store mechanics, no new events.
- `busyOverlay` is NOT used for the form loader (form-local button state,
  not a fullscreen overlay).
- The already-committed same-day work (dev 1e3a1f4..dff4674: auth error
  text mapping, overlay flake test, gitignore) is CONTEXT, not scope; a
  prepared patch for the CSRF fix exists in `git stash` (wip: csrf
  duplicate-cookie fix + tests — deps.py AND the test file; inspect with
  `git stash show --include-untracked 'stash@{0}'`) and MAY be applied by
  the worker as the implementation of WS-BE-CSRF — the plan does not
  depend on it.

## Non-goals

- No logout fallback that ignores CSRF failures (server-side tolerance of
  duplicates fixes the real cause; a client-side "logout anyway" would hide
  contract defects).
- No password reset flow, no logout-all UI changes, no touched profile
  forms (`Form` value plumbing is additive; the profile page keeps its
  `_setProfile` behavior).
- No redirect/transition change after successful auth (messenger/profile
  targets stay as-is).
- No i18n framework: the two in-flight button labels are inline copy like
  the existing form copy.
