# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-UI-1` | `REQ-CHAT-UI` | `EV-UI-1` | Own messages render right-aligned with the mine bubble style, others left-aligned with the theirs style; every message shows its HH:MM time from the `time` field; the first message of each day carries a localized day marker («Сегодня»/«Вчера»/date). Covered by component tests. |
| `AC-UI-2` | `REQ-CHAT-UI` | `EV-UI-2` | At 375px and 768px viewports the chat screen is usable: the users list and the chat pane do not overflow horizontally, controls remain reachable, and on mobile (<768px) the list and the chat pane switch (selecting a chat shows the pane with a back control that returns to the list). Verified by scripted DOM/geometry checks plus screenshots at 375/768/1280. |
| `AC-UI-3` | `REQ-CHAT-UI` | `EV-UI-1` | The desktop layout (>=1024) keeps its current two-column geometry; `npm run verify` (incl. stylelint) is green; no new lint suppressions. |

## Evidence contract

`EV-UI-1`: verify receipt + component tests (sides, time, day marker). `EV-UI-2`:
playwright viewport receipts — DOM assertions (own bubble right of center, theirs
left, no horizontal overflow at 375/768, mobile switch works) plus screenshots
saved under `work/2026-10-19-chat-ui-polish/evidence/screens/` for operator review.
