# Acceptance criteria — 2026-11-07-auth-session-ux

## AC-BE-CSRF — duplicate-cookie tolerant double-submit (pytest)

`backend/tests/unit/auth/test_csrf_duplicates.py` proves via direct
`require_csrf` calls on hand-built Starlette Request scopes:

1. a single matching cookie + matching header passes;
2. RED-GREEN pin: a scope whose `headers` list carries TWO cookie entries
   — `(b'cookie', b'chatty_csrf=<stale>')` then
   `(b'cookie', b'chatty_csrf=<fresh>')` — passes with the fresh value in
   `X-CSRF-Token` after the fix AND FAILS on the unpatched `require_csrf`
   (the live 2026-11-07 logout repro shape; Starlette parses only the
   first Cookie header);
3. RED-GREEN pin: the single-header variant
   `chatty_csrf=<fresh>; chatty_csrf=<stale>` (within one header the LAST
   duplicate wins) passes after the fix and fails on the unpatched check;
4. a header matching NO copy → 403 `csrf_failed`;
5. missing header or no cookie at all → 403 `csrf_failed`.

Backend gate verdict (delta contract): pytest summary vs the captured
baseline — the failed set is EXACTLY the 4 known pre-existing Windows
ingestion/converter failures, all new tests passing. `backend/verify.sh`
exits non-zero at baseline on this Windows stand BY DESIGN; the delta is
the verdict, not exit-0.

## AC-FE-LOADING — auth flight state visible and safe (mocha)

1. While a signin request is pending, the login submit button is disabled
   and relabeled `Signing in…`; the register submit button mirrors with
   `Signing up…` (`authLoading` in the store).
2. The in-flight label/disabled state reverts after the request settles —
   success path AND error path (`finally` semantics; controller tests pin
   both with a deferred promise).
3. An Enter-initiated submit during the flight is ignored — the submit
   handler consults the live `authLoading` prop, not only the disabled
   button attribute.

## AC-FE-VALUES — typed values survive error renders (mocha)

1. On the login page: fill `login` and `password`, then set `authError` in
   the store → after the re-render both inputs hold the typed values and
   the error paragraph shows the message.
2. On the register page: same pin for `email`, `password`,
   `confirm_password`.
3. The error paragraph and the inputs coexist (error shown, values kept —
   the operator's exact ask).

## AC-PROCESS — gates and bookkeeping

`npm run verify` exit 0 with mocha grown from the 721 baseline; backend
gate per the AC-BE-CSRF delta contract;
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict` exit 0;
no file outside the manifest write-sets changes (ownership audit clean);
`docs/progress/progress_log.md` run record on top; all work on
`feature/2026-11-07-auth-session-ux` from dev @ dff4674, one PR to dev
after the run.

## Evidence routes

- EV-BE-1: backend gate output (Windows form: collected/passed/failed +
  new-test identities) under `work/2026-11-07-auth-session-ux/evidence/WS-BE-CSRF/`.
- EV-FE-1: `npm run verify` output (exit code, mocha count) under
  `work/2026-11-07-auth-session-ux/evidence/WS-FE-AUTH-UX/`.
- EV-PROCESS-1: guard strict output + ownership audit + progress-log diff.

## Checklist

| Criterion | Requirements | Evidence | Status |
| --- | --- | --- | --- |
| `AC-BE-CSRF` | `REQ-BE-CSRF` | `EV-BE-1` | pending |
| `AC-FE-LOADING` | `REQ-FE-LOADING` | `EV-FE-1` | pending |
| `AC-FE-VALUES` | `REQ-FE-VALUES` | `EV-FE-1` | pending |
| `AC-PROCESS` | `REQ-PROCESS` | `EV-PROCESS-1` | pending |
