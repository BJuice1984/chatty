# Plan review request — 2026-11-01-chat-leave

Independent plan review is requested for the S2 package
`tasks/2026-11-01-chat-leave/` (base feature/2026-11-01-contacts @
25f1868 — the open contacts PR line).

## What to review

- `plan.manifest.json` — 4 requirements, 3 workstreams, write
  ownership, budgets, gates
- `plan.md` — the operator decisions, the API contract (7 points) and
  the waves
- `acceptance-criteria.md` — the AC table + details
- `developer-overview.md` — the map and risks

## Review focus

1. Contract soundness against the live code: the header avatars today
   (`messenger.hbs` ChatAvatar onClick via `getChatUsers` ->
   `deleteChatUsers` -> `unsupported removeUsers`) — is the
   replacement plan accurate? Router-order traps for
   `DELETE /{chat_id}/members/{user_id}` and `POST /{chat_id}/leave`
   vs the int routes (`/search`, `/dm` precedents)? `ChatResponse`
   additive `left_at` None-default vs the model_validate paths (the
   is_dm/last_message precedents)?
2. Membership-guard split completeness: `require_member` /
   `require_owned` call sites across chats/messages/reactions/ws —
   does the read-vs-write split cover every path (messages POST, WS
   send, reactions, mark_read, members, bot runs?) without breaking
   existing tests (184→218 suite, ai-assistant private chats)?
3. WS archive filter feasibility: the hub fan-out in
   `backend/app/ws/hub.py` / `ws/router.py` — is the DB-backed
   active-membership filter at fan-out sound and testable at
   integration level, or does the plan's "deepest level the harness
   allows" hedge need tightening?
4. The adder seam: a SECOND injected callback (`setContactAdder`)
   beside `setChatOpener` in features/index.ts — legal (the guard
   allows cross-feature only there), but is mirroring the seam the
   right call vs a single integration object?
5. Ownership/isolation: do the write-sets cover the work without gaps
   (readOnly must not intersect another workstream's writes)? Are the
   plannedItems executable as stated?
6. Missing acceptance: any operator ask (menus, conditional contact
   item, owner-only kick, leave semantics, dimmed archive card, no
   incoming messages, history kept) not pinned by an AC?
7. Tier honesty: S2 (multi-owner, browser, migration/data, security) —
   anything to narrow or widen? Non-goals sane (no rejoin button, no
   ownership transfer, no member-list WS push)?

## Verdict

Return `READY_TO_FREEZE`, `BLOCKED` with findings, or clarification
questions. Budget: 2 rounds.
