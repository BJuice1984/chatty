# Plan review request — 2026-11-07-auth-session-ux

Reviewer: independent-plan-reviewer (audit-agent-plan). Do not implement.

Review the S2 plan package at `tasks/2026-11-07-auth-session-ux/`
(plan.manifest.json, plan.md, specification.md, developer-overview.md,
acceptance-criteria.md, tier-request.json, tier-resolution.json).

## Context for the reviewer

- Baseline: local `dev` @ dff46746facb861fd3b29261e1be1c0104be71fd.
  Same-day already-committed context (NOT scope): auth error text mapping
  (1e3a1f4), chats overlay flake test fix (3c9bb7f), gitignore entry
  (31d5304), progress log (dff4674). Operator-side: CORS allowlist repair
  in the gitignored `.env.compose.local`, api container recreated.
- Live repro of the CSRF defect (curl, 2026-11-07): `POST /auth/logout`
  with TWO Cookie header entries — `chatty_csrf=<stale-path-copy>` first,
  `chatty_csrf=<fresh>` second — and `X-CSRF-Token: <fresh>` answers
  `403 csrf_failed`; with a single cookie it answers `200`. Starlette's
  `Request.cookies` parses only the FIRST raw Cookie header
  (`headers.get('cookie')`); within a single header the LAST duplicate
  name wins.
- A prepared implementation of WS-BE-CSRF exists in `git stash`
  ("wip: csrf duplicate-cookie fix + tests" — deps.py AND the test file;
  inspect with `git stash show --include-untracked 'stash@{0}'`; plain
  `stash show` hides the untracked test) and may be applied by the worker;
  the plan permits this explicitly. The stashed test PREDATES the rev-2
  red-green pins — its only duplicate case is the stale-first
  single-header arrangement, which passes on unpatched starlette 0.48.0;
  it must be extended with both red-green cases per AC-BE-CSRF and its
  docstring corrected.
- Backend gate on this Windows stand: 4 pre-existing failures in
  tests/unit/ingestion/test_converter.py (WinError 193 — `.sh` scripts not
  executable on Windows), predating the plan; the acceptance contract is
  the delta: failed set == exactly those 4 known failures, all new tests
  passing (verify.sh exit is non-zero at baseline on Windows by design).
- Operator commit rule: conventional commits, no co-author trailers.

## What to check

Requirements/AC/evidence traceability (REQ→AC→EV ids consistent);
write-set exactness (no shared file between workstreams except none;
Store.ts owned by WS-FE-AUTH-UX only); tier S2 structure completeness
(specification present, budgets, context limits, security gates);
feasibility of the value-preservation mechanism against the actual Block
lifecycle (page-level draft harvest in componentDidUpdate, additive value
plumbing through form.hbs/labeledInput.hbs/input.hbs); the loading-state
Enter-guard necessity (disabled button does not block form submit events);
non-goals sanity (no client-side logout CSRF bypass); validation commands
runnable on this stand.

Return the review as `tasks/2026-11-07-auth-session-ux/plan-review.json`
per the plugin's plan-review schema, verdict READY_TO_FREEZE or findings.
