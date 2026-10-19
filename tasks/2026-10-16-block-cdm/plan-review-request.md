# Plan review request — 2026-10-16-block-cdm

Reviewer: independent-plan-reviewer; verdict READY_TO_FREEZE or
CHANGES_REQUIRED (max 3 rounds). Review the whole package directory.

Focus: (1) activation-point choice (Router render helper vs Block mount
hooks) and remount safety semantics (guard placement, destroy reset);
(2) recursion completeness (children vs _hbsChildren vs __children legacy
naming — check registerComponent compile interplay); (3) consumer migration
completeness (any other dormant componentDidMount definitions? grep src);
(4) main.ts forbidden yet bootstrap double-fetch accepted — coherent?;
(5) test plan sufficiency for a core-class change with 181 existing tests
relying on current behavior; (6) write-set completeness and AC/EV binding.
