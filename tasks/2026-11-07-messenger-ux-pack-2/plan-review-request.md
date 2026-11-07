# Plan review request — 2026-11-07-messenger-ux-pack-2

Reviewer: independent-plan-reviewer (audit-agent-plan). Do not implement.

Review the S2 plan package at `tasks/2026-11-07-messenger-ux-pack-2/`
(plan.manifest.json, plan.md, specification.md, developer-overview.md,
acceptance-criteria.md, decisions.md, tier-request.json,
tier-resolution.json).

## Context for the reviewer

- Baseline: `origin/dev @ 6eef4f0a99f696b7b5faa4eab4382627b607473f`
  (merge of PR #56 — the auth-session-ux contour this pack rides on).
- Ten operator items collected 2026-11-07; research is file:line-verified
  (two read-only recon reports; key facts embedded in
  developer-overview.md).
- The operator PRE-AUTHORIZED execution and delegated blocker resolution
  to the controller; every controller decision is journaled in
  decisions.md (D-1..D-8) — review those decisions for project-fit too.
- Notable research findings the plan relies on: branch `main` predates
  the mark-all-read feature (its header has a settings icon) — hence
  D-1 interprets "restore the old icon from main" as the settings-icon
  VISUAL with the feature intact; `--secondary-text-color` referenced by
  the auto-title chip does NOT exist in the repo; the badge hides
  because it is inline content INSIDE the truncating h4; nothing renders
  between WS send and echo today (no optimistic entry, no sent marker);
  wsDeadChats exists in the controller but is not surfaced to the UI and
  a ChatInfo flag would be wiped by every fetchChats (hence the
  cast-idiom store key).
- Live-stack caveat: mocha baseline is 733 (post PR #56); verify runs
  green at base.

## What to check

REQ→AC→EV traceability (10 requirements, 10 ACs, checklist table
present); write-set exactness for the single WS-ALL workstream (27
files — is anything the implementation will realistically touch
missing? e.g. does the badge restructure need chatListUser.ts? does the
loader/disclaimer need more of chat.hbs/chat.ts than declared?);
forbiddenWrites sanity (backend entirely forbidden — confirm no item
needs it); feasibility of each item against the researched mechanics
(especially REQ-CHECK's echo-replace FIFO and REQ-FORMS' imperative
disabled toggling vs the Block lifecycle); decisions D-1..D-8 for
project-fit; tier S2 (browser-risk, single owner — one-workstream shape
per the 2026-11-04 precedent); budgets/context limits; gates runnable
(npm run verify, guard strict — both green at base).

Return the review as `tasks/2026-11-07-messenger-ux-pack-2/plan-review.json`
with verdict READY_TO_FREEZE or findings.
