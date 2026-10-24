# Plan review request — 2026-10-21-stories (revision 2)

Round 1 returned REWORK (3 MAJOR: Escape focus path, raw-HTML ref / CDM
change-listener wiring, viewer-owned zombie timer). Revision 2 reworks the
design: the chat page owns the auto-close timer (private field, cleared
before re-arm / on close / in destroy override), re-focuses the overlay in
componentDidUpdate while a story is open, and wires the hidden file input
through a delegated `change` events prop (querySelector at click time, no
ref on raw HTML); the viewer became presentational. Acceptance criteria now
split jsdom-provable claims from a manual checklist.

Independent plan review of `tasks/2026-10-21-stories/` (S2, tier resolved by
`agent-lifecycle tier resolve`, browser-risk). Base revision
`e3ff881` (head of `feature/2026-10-19-chats-social`, stacked because
chats-social touches the same chat-page files and is not merged to dev yet;
contingency documented in plan.md: rebase onto dev after the chats-social
merge, PR after it).

Review scope:
- requirements ↔ acceptance criteria ↔ evidence mapping (specification.json,
  acceptance-criteria.md, plan.manifest.json);
- workstream write-set exactness (only the 13 declared files; plan-package
  and progress-log are controller-owned);
- architecture fit: layers downward, no api/ imports in UI, no
  controller/store changes, Block lifecycle (CDM once per instance,
  destroy() cascade) respected by the timer design;
- risk handling: viewer timer cleanup on every close path and destroy,
  object URL lifecycle, hidden file input reset;
- budgets, context limits, orchestration caps sanity for one frontend
  workstream;
- anything missing for the three operator asks: fullscreen timed viewer,
  add-story via file picker, unread ring fading after view.

Do not implement. Return the verdict in the plugin's review report format
(READY_TO_FREEZE / REWORK / BLOCKED) with findings.
