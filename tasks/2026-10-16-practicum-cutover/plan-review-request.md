# Plan review request — 2026-10-16-practicum-cutover

Reviewer: independent-plan-reviewer (surface `independent-release-reviewer`).
Deliverable: `tasks/2026-10-16-practicum-cutover/plan-review.json`, verdict
`READY_TO_FREEZE` or `CHANGES_REQUIRED` (max 3 rounds).

## What to review

Manifest `tasks/2026-10-16-practicum-cutover/plan.manifest.json` (r1, DRAFT),
`plan.md`, `acceptance-criteria.md`, `specification.json`,
`developer-overview.md`, tier files.

## Context you need

- Base `dev@d72a4ce` (PR #24, stage 11 merged).
- The first live run of the own contour (2026-10-15/16) closed the stage-11
  browser checklist and surfaced LIVE-2…LIVE-7 + HD-R3; fixes already sit in
  the working tree of `feature/2026-10-16-practicum-cutover` and `npm run
  verify` is green (172 tests). WS-LIVE-CUTOVER (phase A) adopts them into the reviewed
  delta (review + missing regression tests) instead of re-implementing.
- Operator decision 2026-10-16: the project will not depend on the Yandex
  Practicum course backend again — WS-LIVE-CUTOVER (phase B) removes every
  dependency (adapters, env fork, forms, course bats CI, docs).

## Review checklist (expected focus)

1. **Pre-applied fixes governance**: is adopting live-applied fixes with
   mandatory per-finding regression tests an acceptable reviewed path (vs.
   revert-and-reimplement)? Are the write-sets complete for every touched
   path (`git status` parity)?
2. **Cutover completeness**: any practicum dependency the write-sets miss?
   Check `src/utils/env.ts`, `src/utils/types.ts`, `src/features/*/api/*`,
   `ws/gateway.ts`, forms, `.github/workflows/tests.yml` deletion, docs list;
   grep-gate scope (`src/`, `.github/`, README/AGENTS/CLAUDE, `docs/arch/`)
   vs exempt archives (`docs/progress/`, `tasks/`).
3. **Preservation invariants**: backend/, `verify.yml`, `netlify.toml`,
   `docs/project-principles.json`, `src/main.ts`, `src/features/index.ts`,
   `chats/{module,store,controller}.ts` untouched — sufficient and correct?
4. **Register form slimming**: dropping login/first_name/second_name/phone
   inputs (own backend accepts email+password only) — acceptable UX/contract
   call or should the form keep cosmetic fields?
5. **HD-R2 design**: re-request initial history on transport Connected after
   an internal reconnect (append-dedup already guaranteed) — sound?
6. **Env fork collapse**: single own mode, `VITE_APP_MODE` removal, example
   env naming (`.env.own.example` vs `.env.example`) — pick one and verify
   docs/runbook alignment.
7. **AC/EV binding**: every AC has deterministic validation; grep gate is
   scriptable; live re-smoke rows (AC-CUT-3) remain honest (UNAVAILABLE
   policy for absent Ollama AI rows).
8. **Ambiguities**: anything under-specified for a worker to execute safely
   in ≤2 attempts per task?

## Out of scope for this review

Backend code, principles digest, production deployment, sprint_* branches.
