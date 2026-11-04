# Plan review request — 2026-11-04-bot-wait-offline

Reviewer: independent plan reviewer (not the plan author).
Deliverable: verdict `READY_TO_FREEZE` or findings, against this package:

- `plan.manifest.json` — the v1 manifest (requirements, workstreams, write
  ownership, evidence, budgets, gates)
- `plan.md` — narrative plan (operator intent, recon, design, waves)
- `developer-overview.md` — intent, boundaries, mechanics, risks, non-goals
- `acceptance-criteria.md` — the five AC with evidence ids
- `tier-request.json` / `tier-resolution.json` — S2 resolution

## What to check (round 2 — confirm over revision 2)

Round 1 verdict NEEDS_REVISION with F-1..F-7 + N-1..N-3. Revision 2 claims
ALL findings resolved — verify each in the actual files:

1. **F-1 (pending linkage)**: the placeholder gains ONE optional
   creator-written field `pending_for` (question message id) in
   `REQ-FE-BOT-DELTA`; the cacheKey for the placeholder is the FIXED
   `pending:tail` (no question-id coupling in RENDER-PERF); the linkage
   creator and the bot_delta consumer share ONE owner (`WS-FE-RESILIENCE`,
   3-workstream decomposition) — check no wave can improvise the matching
   and the store-shape constraint permits exactly this one field.
2. **F-2 (destroy cascade)**: the retained exemption is specified in
   REQ-FE-RENDER-PERF, plannedItems AND AC (retained instances survive the
   compile sweep AND a full parent destroy with a live element).
3. **F-3 (Close intent)**: adapter-side intent marks BEFORE `socket.close()`
   on every intentional path; ONLY unmarked exhaustion closes notify;
   negative pins in AC-FE-OFFLINE; WSTransport stays payload-free
   (probe-only addition).
4. **F-4 (warm-up)**: dropped everywhere — REQ/connectivity/AC/security
   gate replaced by SEC-NO-WARMUP (`features/auth` is a forbidden write).
5. **F-5/F-6 (counts/commands)**: mocha base 623; backend Windows form
   (259 passed + 4 known ingestion failures) recorded; validation commands
   include both Windows and canonical forms.
6. **F-7 (stories)**: `reconnectStoriesSocket` force variant owned with
   tests; stories/ws files moved from readOnly to writes.
7. **N-1..N-3**: complete_stream explicit on BOTH providers; residual
   O(n)-per-emit documented (Risks + AC-PROCESS measured-timing record);
   multi-tab streaming limitation documented in nonGoals + deferred note.
8. **Contract faithfulness, streaming soundness, ownership disjointness
   (RENDER-PERF ‖ BE-STREAM  RESILIENCE-after-BE-STREAM), evidence
   routing, budgets, non-goals** — unchanged from round 1; re-confirm the
   package is internally consistent with no stale 4-workstream/600/262
   residue.

Repository: `feature/2026-11-03-auth-refresh-retry` @ `4edbd99`.
Reply with findings (id, severity, file, what/why) and an explicit verdict.
