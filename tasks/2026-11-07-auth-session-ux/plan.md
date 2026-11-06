# Plan — 2026-11-07-auth-session-ux

Operator-reported session UX defects of 2026-11-07 (after the all-user
password rotation and api-container recreation): logout dies with
`csrf_failed` when the request carries a duplicate `chatty_csrf` cookie;
a successful login keeps showing the idle auth form for the whole flight;
a failed login/registration wipes the typed credentials. Full ALK cycle on
branch `feature/2026-11-07-auth-session-ux` from local `dev` @ dff4674.

Context already in dev this day (1e3a1f4..dff4674): human-readable auth
error texts by HTTP status (401/409/422 map in
`src/features/auth/controller.ts`), the chats reconnect-overlay flake test
fix, `credentials.local.md` gitignore entry, and the operator-side CORS
allowlist repair (`.env.compose.local`, not in git). This plan does not
redo any of it; the CSRF/loader/value work rides on top.

## WS-BE-CSRF — duplicate-cookie tolerant double-submit (backend)

`backend/app/core/deps.py::require_csrf` reads `request.cookies.get(...)`;
Starlette's `Request.cookies` parses only the FIRST raw Cookie header
(`headers.get('cookie')`) and WITHIN one header the LAST duplicate name
wins (dict assignment) — so a duplicate in either arrangement (two header
entries with the stale copy first, or one header where the fresh copy
precedes the stale one) shadows the fresh value and fails logout/refresh
with `403 csrf_failed` even when `X-CSRF-Token` matches what
`document.cookie` shows (live curl repro 2026-11-07: two Cookie header
entries, stale first).

- Parse ALL raw Cookie headers (`request.headers.getlist('cookie')`) into
  the list of values for `settings.csrf_cookie_name`; accept when the
  submitted header constant-time-matches ANY copy; keep `validate_origin`
  and the 403 `csrf_failed` shape untouched. Helper stays private and
  unit-pure.
- Tests: `backend/tests/unit/auth/test_csrf_duplicates.py` (hand-built
  Request scopes; the AC-BE-CSRF cases with RED-GREEN pins — the duplicate
  cases MUST fail on the unpatched check).
- A prepared patch sits in `git stash` ("wip: csrf duplicate-cookie fix +
  tests" — deps.py AND the test file; inspect with `git stash show
  --include-untracked 'stash@{0}'`) — apply it or reimplement equivalently;
  do not diverge from the AC.
- Gate: backend pytest summary delta vs the captured baseline (Windows
  stand form: `PYTHON_BIN=backend/.venv/Scripts/python.exe bash
  backend/verify.sh`; the failed set must be exactly the 4 known
  pre-existing converter failures and all new tests must pass — the script
  exits non-zero at baseline on Windows by design; the delta is the
  verdict, not exit-0).

## WS-FE-AUTH-UX — form loader + typed-value preservation (frontend)

1. Loading state: `AppState`/`ComponentProps` gain optional `authLoading`
   (field only); `authSlice.setAuthLoading`; controller `signin`/`signup`
   wrap the flight (`true` up front, `false` in `finally`); login/register
   pages map it through `withStore`, `render()` swaps the primary button to
   the in-flight label (`Signing in…` / `Signing up…`) with
   `disabled: true`, and the submit handler ignores any submit event while
   the flight is on (Form's submit handler invokes handleSubmitClick on
   EVERY submit event — a dispatched/implicit submit bypasses the disabled
   button; browser implicit-submission behavior around disabled default
   buttons is historically inconsistent, so the page-level guard is the
   reliable barrier); `Button` gains `disabled?: boolean` +
   `{{#if disabled}}disabled{{/if}}` in `button.hbs` AND
   `disabled=this.disabled` forwarding in the `form.hbs` Button invocation
   (the buttons array reaches Button only through that hash — without the
   forwarding the attribute never renders).
2. Value preservation: pages keep a private `draft` map; `componentDidUpdate`
   harvests live input values from the old DOM before re-render; `render()`
   merges `draft` into the `inputs` array; plumbing is additive —
   `FormInputs.value?`, `form.hbs`/`labeledInput.hbs` pass `value` down,
   `input.hbs` renders the `value` attribute conditionally
   (`{{#if value}}value="{{value}}"{{/if}}` — no empty `value=""` on
   value-less inputs; harmless either way, but keeps profile-form markup
   unchanged). Profile page untouched.
3. Tests: `login.test.ts` (values survive authError; disabled+relabel in
   flight; revert after settle), `register.test.ts` (three fields
   preserved), `controller.test.ts` (authLoading true while pending,
   false after resolve AND reject — deferred promise).
4. Docs: progress-log run record on top.

Gate: `npm run verify` (mocha grows from 721), guard strict 0.

## Sequencing

WS-BE-CSRF first, then WS-FE-AUTH-UX (`dependsOn: ["WS-BE-CSRF"]` in the
manifest DAG; write-sets disjoint, the dependency is the project's
backend-contract-first convention). One PR to dev after final audit. No
deploy/sprint branches.
