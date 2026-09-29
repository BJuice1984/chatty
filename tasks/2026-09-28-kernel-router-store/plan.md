# Implementation plan

1. Record current Router, Store, Block and EventBus contracts.
2. Implement route parameters, lazy route loading/error fallback, 404 and guard seams without changing page ownership.
3. Refactor Store updates around typed slices and shallow comparison while preserving existing callers.
4. Make Block teardown unsubscribe every Store/EventBus listener and cover replacement, destroy and update ordering with jsdom tests.
5. Produce the explicit `TRANSITIONAL_DEBT` handoff for stage 3, then run focused tests and the repository verify gate.

The worker owns only the manifest paths. A handoff is evidence, not permission to edit `.claude/hooks/scripts/guard-architecture.mjs`.
