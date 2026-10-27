# Plan review request — 2026-10-27-chats-search-trgm

Independent plan review is requested for the S2 package
`tasks/2026-10-27-chats-search-trgm/` (base `dev` @ 5db03ac, PR #42 merged).

## What to review

- `plan.manifest.json` — requirements, AC/evidence traceability, ownership,
  budgets, gates (one workstream: WS-BE-TRGM)
- `specification.json` — pg_trgm functional GIN indexes over the exact
  search expressions; zero query-code changes; FTS kept a non-goal
- `plan.md`, `acceptance-criteria.md`, `developer-overview.md`

## Review focus

1. Soundness: do functional `gin_trgm_ops` indexes over `lower(title)` /
   `lower(content)` actually serve the repository queries
   (`repositories/chats.py::search_title_matches` / `search_message_matches`)
   as written (escape clause, `content IS NOT NULL`, membership joins)?
2. Migration precedent: is the PG-only stance consistent with the repo
   (005 precedent; tests create_all; verify:backend = pytest + heads)?
3. Evidence design: is the scratch-PG round-trip + EXPLAIN (enable_seqscan=off
   demonstration, default-planner note) the right honest proof?
4. Scope: is "no application-code change" realistic — anything in app code
   the worker would be tempted to touch that the write-set correctly excludes?
5. Risks missed: extension privileges on managed PG, GIN write-amplification
   on messages, anything else material.

## Verdict

`READY_TO_FREEZE`, `BLOCKED` with findings, or clarification questions.
Budget: 2 rounds.
