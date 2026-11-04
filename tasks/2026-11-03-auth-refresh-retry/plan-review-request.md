# Plan review request — 2026-11-03-auth-refresh-retry

Reviewer: independent plan reviewer (not the plan author).
Deliverable: verdict `READY_TO_FREEZE` or findings, against this package:

- `plan.manifest.json` — the v1 manifest (requirements, workstreams, write
  ownership, evidence, budgets, gates)
- `plan.md` — narrative plan
- `developer-overview.md` — intent, boundaries, mechanics, risks, non-goals
- `acceptance-criteria.md` — the four AC with evidence ids
- `tier-request.json` / `tier-resolution.json` — S2 resolution

## What to check

1. **Contract faithfulness**: the plan must deliver the operator request
   verbatim — 401 → refresh → replay of the original request; failed refresh
   → kick-out to sign-in; full-screen dimming + spinner with
   «Пожалуйста, ожидайте» and three ANIMATED dots during refresh; 500 →
   retry of the request with the same overlay reading «Возможно, проблемы на
   сервере.. Мы пробуем переподключиться»; frontend AND backend checked.
   Clarified: all-method 500-retry, schedule 2s/6s/12s.
2. **Security soundness**: single-flight refresh (one-shot rotation),
   `/auth/`-prefix exclusion (no recursion, no retry storms on the login
   form), csrf re-read before replay, fast-fail on absent csrf cookie,
   failed-refresh local logout semantics.
3. **Ownership**: write-sets exact and disjoint; no readOnly of another
   workstream's writes; dependencies expressed by `dependsOn` only;
   forbidden writes exclude `work/` and `.alk/`; `backend/app` code is not
   writable (backend packet is tests-only).
4. **Layering**: `HTTPTransport` learns the interface only; policy lives in
   `features/auth`; overlay is a utils DOM module; binding in
   `features/index.ts`; guard strict stays 0.
5. **Evidence and gates**: every AC has executable evidence; evidence ids
   have exactly one workstream owner; budgets, contextLimits, finalAuditGates
   and securityGates are S2-complete; validation commands runnable as
   written.
6. **Non-goals honesty**: cold-boot `meWithRefresh` intentionally kept (two
   refresh paths by design), WS untouched, no backend code change planned.

Repository: `feature/2026-11-03-auth-refresh-retry` @ 7dbd7aa (base `dev`).
Reply with findings (id, severity, file, what/why) and an explicit verdict.
