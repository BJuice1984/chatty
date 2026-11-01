# Plan review request — 2026-11-01-contacts

Independent plan review is requested for the S2 package
`tasks/2026-11-01-contacts/` (base `dev` @ 238ec53).

## What to review

- `plan.manifest.json` — requirements, acceptance/evidence traceability,
  write ownership, DAG, budgets, final audit gates
- `specification.json` — the S2 product specification (4 requirements:
  contacts persistence + implicit capture, DM get-or-create, frontend
  feature module, frontend UI/route)
- `plan.md` — the API contract (the wave decoupling point) and the
  three waves
- `acceptance-criteria.md` — the AC table and details
- `developer-overview.md` — the developer map and risks

## Review focus

1. Contract soundness: does the contacts domain follow the existing
   patterns — `register_domain` composition seam (users.py precedent),
   get-then-insert idempotency (add_member), `UserSearchItem` naming
   rule, `schemas/file.avatar_url`, route ordering (`/chats/dm` before
   `/{chat_id}`, the `/search` precedent)? Is the implicit capture
   inside the `add_member` transaction safe and free of cycles
   (ChatService uses ContactRepository, not ContactService)?
2. DM semantics: is `is_dm` + `find_dm` (both memberships, earliest id)
   correct and collision-free against plain 2-member groups? Is the
   documented edge (a DM later grown via the members endpoint) honestly
   scoped?
3. Frontend architecture: is the new `src/features/contacts/` module
   truly self-sufficient (no cross-feature imports), and is the
   `setChatOpener` injection through `features/index.ts` the right
   legal seam (the `setProfileController` precedent)? Any layer
   violation the guard would miss (e.g. page importing from
   components/messenger, USER_SEARCH_DEBOUNCE_MS reuse)?
4. Ownership/isolation: do the three write-sets cover the work without
   gaps or overlaps (readOnly must not intersect another workstream's
   writes)? Are the plannedItems executable as stated?
5. UX decisions to sanity-check: Modal-based contact menu (vs an
   anchored popover); simplified sidebar (no stories row / no chat
   search bar); `chatPaneOpen` initial value change (any return to
   /messenger with a live selection now opens the pane on mobile) —
   behaviour change documented and pinned.
6. Missing acceptance: any operator ask (implicit capture from
   chat-adds, «Добавить» reusing the search, menu Создать/Найти все
   чаты stub, delete with confirmation, styles for all resolutions)
   not pinned by an AC?
7. Tier honesty: S2 (multi-owner, migration/data, browser, security) —
   anything that should narrow or widen the tier or the non-goals?

## Verdict

Return `READY_TO_FREEZE`, `BLOCKED` with findings, or clarification
questions. The planner will revise and re-submit until READY_TO_FREEZE
or the review budget (2 rounds) is exhausted.
