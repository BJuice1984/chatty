# Developer overview — 2026-11-07-auth-session-ux

## What you will build

Two independent bounded fixes on branch `feature/2026-11-07-auth-session-ux`
(baseline: local `dev` @ dff4674):

### WS-BE-CSRF — duplicate-cookie tolerant double-submit

`backend/app/core/deps.py::require_csrf` currently reads
`request.cookies.get(settings.csrf_cookie_name)`. On the pinned
starlette 0.48.0 `Request.cookies` parses only the FIRST raw Cookie
header (`headers.get('cookie')`), and WITHIN a single header the LAST
duplicate name wins (dict assignment) — so a duplicate in either
arrangement (two Cookie header entries with the stale path-scoped copy
first — the live curl repro — or one header with the fresh copy preceding
the stale one) shadows the fresh value and fails logout/refresh with
`csrf_failed` even with a correct `X-CSRF-Token` header (the JS reads the
value `document.cookie` shows — the fresh one).

Change: parse ALL raw `Cookie` headers
(`request.headers.getlist('cookie')`) and accept the request when the
submitted header matches ANY copy of the named cookie. Per-copy comparison
stays `hmac.compare_digest`. Everything else in `require_csrf` — the
`validate_origin` call, the 403 `csrf_failed` shape — is unchanged.
A prepared implementation exists in `git stash` ("wip: csrf
duplicate-cookie fix + tests": deps.py AND
tests/unit/auth/test_csrf_duplicates.py — inspect with
`git stash show --include-untracked 'stash@{0}'`, plain `stash show` hides
the untracked test); the worker may apply it and verify, or reimplement
equivalently. NOTE: the stashed test PREDATES the rev-2 red-green pins —
its only duplicate case is the stale-first single-header arrangement,
which PASSES on unpatched starlette 0.48.0 (last-duplicate-wins) and is
NOT a regression proof; extend it with BOTH red-green cases per
AC-BE-CSRF (two Cookie header entries stale-first; single-header
fresh-first) and correct its docstring (the "request.cookies keeps only
the first copy" story is wrong — first HEADER, last duplicate within it).

Tests: `backend/tests/unit/auth/test_csrf_duplicates.py` — direct
`require_csrf` calls on a hand-built Starlette Request scope (no HTTP
client needed for duplicate control): single matching cookie passes;
TWO cookie header entries (stale first) passes post-fix and FAILS on the
unpatched check (red-green pin, the live repro shape); the single-header
variant `chatty_csrf=<fresh>; chatty_csrf=<stale>` (last-duplicate-wins)
pinned the same way; header matching no copy → 403; missing header or
missing cookie → 403.

Gate: backend pytest delta. Windows form on this stand:
`PYTHON_BIN=backend/.venv/Scripts/python.exe bash backend/verify.sh` —
the script exits non-zero at baseline BY DESIGN (4 pre-existing
ingestion/converter failures in `test_converter.py`, WinError 193 —
`.sh` scripts not executable on Windows; they predate this change).
Verdict contract: the failed set is EXACTLY those 4 known failures and
all new tests pass.

### WS-FE-AUTH-UX — form loader + typed-value preservation

Three coordinated seams, all frontend:

1. **Loading state.** `src/utils/Store.ts`: add optional `authLoading`
   to `AppState` and `ComponentProps` (field only — no mechanics).
   `src/features/auth/store.ts`: `setAuthLoading(value)`.
   `src/features/auth/controller.ts`: `signin`/`signup` set
   `authLoading=true` up front and `false` in a `finally` (both success and
   every error path). Pages `login.ts`/`register.ts`: `withStore` maps
   `authLoading`; `render()` rewrites the primary button props in flight —
   label `Signing in…`/`Signing up…`, `disabled: true` — and the page's
   `handleSubmitClick` ignores submits while `this.props.authLoading`
   (Form's submit handler invokes handleSubmitClick on EVERY submit event —
   a dispatched/implicit submit bypasses the disabled button entirely, and
   browser implicit-submission behavior around disabled default buttons is
   historically inconsistent, so the page-level guard is the reliable
   barrier). `src/components/button/button.ts` gains `disabled?: boolean`;
   `button.hbs` renders `{{#if disabled}}disabled{{/if}}`; AND
   `form.hbs` forwards `disabled=this.disabled` into the Button helper
   invocation — the buttons array reaches Button ONLY through that
   four-key hash, so without the forwarding the attribute never renders.

2. **Value preservation.** Inputs die on every page re-render because
   `registerComponent` constructs fresh `Form`/`LabeledInput`/`Input`
   instances per compile and input values live only in the DOM. Fix at the
   page level (same pattern as the 2026-11-06 composer draft fix): the page
   keeps a private `draft: Record<string, string>`; `componentDidUpdate`
   harvests live values from the OLD DOM
   (`this.element.querySelectorAll('input[name]')`) BEFORE returning true;
   `render()` merges `draft` into the `inputs` array it hands to the
   template. Plumbing: `FormInputs` gains `value?: string`;
   `form.hbs` passes `value=this.value` into `LabeledInput`;
   `labeledInput.hbs` passes `value=this.value` into `Input`;
   `input.hbs` renders the `value` attribute CONDITIONALLY
   (`{{#if value}}value="{{value}}"{{/if}}` — no empty `value=""`
   attribute on value-less inputs; harmless either way since
   `Input.setValue` writes the DOM property which overrides the
   attribute, but the conditional keeps profile-form markup unchanged).
   The profile page is untouched (its `_setProfile` keeps driving values
   there).

3. **Docs.** `docs/progress/progress_log.md` run record on top.

Tests: `login.test.ts` — typed values survive an `authError` store update
(fill inputs, set store error, assert values); submit button disabled +
relabeled while `authLoading`; returns after settle.
`register.test.ts` — same value-preservation pin for all three fields.
`controller.test.ts` — `authLoading` true while a signin promise is
pending (deferred), false after resolve AND after reject; signup mirrored.

Gate: `npm run verify` (typecheck → mocha → eslint → stylelint), mocha
count grows from the 721 baseline.

## Execution model

- Workstreams are independent (disjoint write-sets, different gates);
  `maxParallelTasks: 1` — run WS-BE-CSRF first (frozen contract first, the
  project's backend-before-frontend convention), then WS-FE-AUTH-UX.
- Each workstream: task-start → implement → `npm run verify` /
  backend gate → task-snapshot claim → task-result → independent
  task-review → implementation audit.
- Pre-commit hook runs `npm run verify` (strict, no autofix) — run
  `npm run eslint:fix`/`stylelint:fix` manually before committing.
- No scss changes expected; if any, zero comments (stylelint convention).

## Risks

- Store field addition is app-wide (withStore consumers) — mitigated:
  optional field, no consumer reads it except the two auth pages.
- Button `disabled` must not break the existing Button tests
  (classType 'disabled' is a STYLE, unrelated to the attribute) — check
  `Button` component tests when touching the template.
- The Windows backend gate's 4 known converter failures are pre-existing;
  never "fix" them in this plan (platform quirk, separate concern).
