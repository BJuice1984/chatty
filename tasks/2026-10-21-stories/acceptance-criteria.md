# Acceptance criteria — 2026-10-21-stories

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-ST-1` | `REQ-STORIES-VIEW`, `REQ-STORIES-READ` | `EV-ST-1` | Clicking a story opens a fullscreen photo overlay; the page-owned timer auto-closes it after 5000 ms; backdrop click and Escape (overlay focused, including after an unrelated re-render while open) close earlier; any close route marks the story viewed and its ring switches to the muted style; sinon fake-timer tests at the timer owner cover timeout close, early close cleanup (no late fire), re-render stability (viewer not closed, timer not doubled) and the viewed flag; the viewer component holds no timers. |
| `AC-ST-2` | `REQ-STORIES-ADD` | `EV-ST-1` | The add tile opens the OS image picker through a hidden `accept="image/*"` input (querySelector at click time, no ref on raw HTML); the delegated `change` handler survives page re-renders, resets `input.value` (same-file re-pick works) and prepends a story with owner "You story" and the unread ring right after the add tile; the viewer does not auto-open; tests assert DOM order (add tile stays first, list length grows by one). |
| `AC-ST-3` | `REQ-STORIES-READ` | `EV-ST-1` | `npm run verify` passes end to end; `guard-architecture.mjs --all --strict` passes; visual notes (progress bar spans the 5 s, fullscreen look and stacking at 375/768/1280, ring fade) are attached to the task result as manual checklist items, not gate claims. |

## Details

### AC-ST-1 — Fullscreen viewer with auto-close and read marking

The auto-close timer lives in a private page field (cleared before re-arm,
on every close path, and in the page's `destroy()` override) because
hbs-embedded children are re-instantiated on every parent re-render without
`destroy()` — a component-owned timer would become a zombie. The page
re-focuses the overlay in `componentDidUpdate` while a story is open
(re-render replaces the focused node; focus falls back to body otherwise).
`storyViewer` tests cover the delegated backdrop click and the
Escape-after-focus path.

### AC-ST-2 — Add-story via file picker

The hidden input is found via `querySelector` at click time (`refs` exist
only for component helpers, never raw HTML); the delegated `change` events
prop is re-attached by `_addEvents` after every re-render (a CDM listener
would die on the first re-render after `fetchChats` → store → withStore).
Object URLs stay in memory for the page lifetime (mock stage, no upload).

### AC-ST-3 — No regressions

Existing suite stays green; manual checklist notes for the task result are
explicitly not gate claims (jsdom cannot prove visual span or layout).
