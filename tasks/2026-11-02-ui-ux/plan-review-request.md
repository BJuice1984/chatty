# Plan review request — 2026-11-02-ui-ux

Independent review of the S2 plan package `tasks/2026-11-02-ui-ux/`
(plan.md, developer-overview.md, acceptance-criteria.md,
plan.manifest.json). Do NOT implement.

Check specifically:

1. Root-cause accuracy — the plan claims (a) the mobile settings pane is
   CSS-unreachable (no mobile rule for `chat__container-profile-changing`),
   (b) the feed autoscroll is dead because page re-renders recreate
   Messenger hbs-children without CDM/CDU and the page CDM scroll listener
   dies with its node, while the page CDU compares `messages` the mapper
   never maps in, (c) the add-user modal never focuses on open and loses
   focus on the empty-query immediate re-render. Verify each claim against
   `src/core/Block.ts`, `src/utils/Store.ts` (withStore/shallowEqual),
   `src/features/chats/pages/chat/chat.ts`,
   `src/components/messenger/messenger.ts`, `src/scss/components/chat.scss`.
2. Write-set completeness and disjointness across the three workstreams
   (wave 1 parallel pair must not share a file; WS-FE-FEED-UX must own
   every file the Messenger-machinery removal touches, plus docs).
3. Acceptance measurability — every AC pinned by named tests/gates; the
   scroll decision table covers append/prepend/pending/chat-change; XSS
   probes for attachment names.
4. Guard/layering — the mock module in components/messenger (not a feature
   import), no upward imports, scss comment ban respected.
5. Blast radius — «Вложение» list/notification placeholders must be
   explicitly out of the change surface; removed Messenger scroll machinery
   has no other consumer; the retired autoDownload template branch keeps
   the settings hint honest.
6. Budgets, evidence routes, orchestration fields consistent with the repo
   conventions (tasks/README.md) and the S2 tier resolution.

Return the verdict (READY_TO_FREEZE / REWORK with findings) as
`tasks/2026-11-02-ui-ux/plan-review.json` (schema agent-plan-review.v1;
see prior packages for the shape).
