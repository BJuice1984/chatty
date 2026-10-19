# Plan review request — 2026-10-19-chat-ui-polish

Reviewer: independent-plan-reviewer; verdict READY_TO_FREEZE or
CHANGES_REQUIRED (max 3 rounds). Review the package directory.

Focus: (1) message-props surface (time/showDate) vs existing data flow —
anything missed in the mapping chain (ws adapters → store → withStore →
messenger.mapTyped → Message)? (2) mobile switch mechanics without
router/store changes — sound and minimal? back-control placement; (3)
breakpoint strategy consistency and stylelint constraints (any files
excluded?); (4) test plan (jsdom component tests for hbs templates;
geometry receipts are live-only); (5) write-set completeness incl. scss
partials if _all.scss must import new files (it must not — only existing
files are edited); (6) AC/EV binding and honest evidence (screenshots are
operator-review artifacts, assertions are the gate).
