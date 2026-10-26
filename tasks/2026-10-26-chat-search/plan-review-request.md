# Plan review request — 2026-10-26-chat-search

Independent plan review is requested for the S2 package
`tasks/2026-10-26-chat-search/` (base `dev` @ 503f455).

## What to review

- `plan.manifest.json` — requirements, acceptance/evidence traceability,
  write ownership, DAG, budgets, final audit gates
- `specification.json` — the S2 product specification (4 requirements:
  last_message in GET /chats, GET /chats/search, frontend logic, frontend UI)
- `plan.md` — the four waves and the API contract
- `acceptance-criteria.md` — the AC table and details
- `developer-overview.md` — the developer map and risks

## Review focus

1. Contract soundness: is the additive `last_message` + the new
   `/chats/search` endpoint consistent with the existing chats code
   (`endpoints/chats.py`, batched unread/members patterns, the users
   prefix-search escaping rule, the `list_before` keyset tie-break)?
2. XSS seam: is escape-then-wrap with raw server-side snippet parts a
   single controllable seam (no other path user text reaches HTML)?
3. Ownership/isolation: do the three write-sets cover the work without
   gaps or overlaps (readOnly must not intersect another workstream's
   writes)? Are the plannedItems executable as stated?
4. Missing acceptance: any behaviour the operator asked for
   (debounce, hide non-matching, title+message highlight, last-message
   order, live lift on incoming/own messages) not pinned by an AC?
5. Tier honesty: S2 (multi-owner, browser, security) — anything that
   should narrow or widen the tier or the non-goals?

## Verdict

Return `READY_TO_FREEZE`, `BLOCKED` with findings, or clarification
questions. The planner will revise and re-submit until READY_TO_FREEZE
or the review budget (2 rounds) is exhausted.
