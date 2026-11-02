# Acceptance criteria — 2026-11-02-ui-ux

Base: `feature/2026-11-02-ui-ux` @ 7dbd7aa (dev tip). Evidence routes:
`EV-MOBILE-1` = npm run verify (settings wave); `EV-MESSENGER-1` =
npm run verify (messenger wave); `EV-PAGEUX-1` = npm run verify + guard
strict (page wave, final).

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-FE-SETTINGS-MOBILE` | `REQ-FE-SETTINGS-MOBILE` | `EV-MOBILE-1` | Each of the six sidebar items (Account, Chats, Appearance, Notification, Privacy, Data Usage), tapped, adds the root modifier `chat_pane-open` and renders exactly that section's `settings-section-*` pane; the back button (`settings-back`) removes the modifier preserving the `section` prop (re-tap re-opens instantly); desktop switching and all existing settings suites stay green; mobile CSS hides `.chat__container-profile-changing` below 768 and shows it under `chat_pane-open` with the modifier inert ≥768 (rules inside the mobile media block). |
| `AC-FE-MESSENGER-SURFACE` | `REQ-FE-MESSENGER-SURFACE` | `EV-MESSENGER-1` | A message with `attachments` renders one `.messenger__message-files` row per item: icon img by extension (pdf; xls/xlsx→xlsx; doc/docx→doc; else generic), the name escaped (hostile-name probe stays text), a «Скачать» link with the item url + `download` attribute (`attachment-download`); mapping pinned: AI chat + incoming + fileUrl → the marked mock list (first name from `file.filename` when present — fixture-only at runtime since no adapter populates `Message.file`; real bot names come from the mock set; real urls), own message in an AI chat → single item, non-AI → single item rendering the «Файл» fallback name at runtime, no file → no list; the mock is single-sourced with a removal marker; the old single-link rendering («Вложение»/«Скачать») is gone from message.hbs; the chat-list and notification «Вложение» placeholders and their suites stay untouched; the add-user modal focuses the search input on open (query cleared) and keeps focus after a full clear; the scroll memory/sync is extracted to `components/messenger/feed-scroll.ts` with the Messenger preserve path intact (zero behavior change) and the messenger suites green. |
| `AC-FE-FEED-SCROLL` | `REQ-FE-FEED-SCROLL` | `EV-PAGEUX-1` | Store-driven page re-renders with flushed frames show: chat change → bottom + that chat's memory cleared; tail append while pinned (within 120px) → bottom; tail append while NOT pinned → saved top restored (reading history never yanked); head growth («загрузить ещё» prepend) → saved top, never bottom; a pending typing-placeholder tail pins the bottom regardless; the engine runs on the shared feed-scroll module alongside the intact Messenger preserve plans (disjoint triggers, one memory); the contacts add-modal focuses its input on open. |
| `AC-PROCESS` | `REQ-FE-FEED-SCROLL` | `EV-PAGEUX-1` | npm run verify exit 0 with mocha counts grown from the 568 base; guard-architecture --all --strict reports 0 at final; no file outside the manifest write-sets changes (ownership audit clean); NEXT.md + progress_log carry the run record with the mock-removal pointer; rides feature/2026-11-02-ui-ux (base dev 7dbd7aa); backend/** untouched. |

## Details

### AC-FE-MESSENGER-SURFACE — why one workstream owns the messenger surface

The attachment mapping seam (withMessenger), the modal focus handlers and
the scroll-memory extraction all live in `messenger.ts`, and the
pinned «Вложение» render expectations live in `messenger.test.ts` — any
split of that surface across waves creates write-ownership conflicts and
cross-wave red gates. The mock module sits in `components/messenger` (same
layer as its only consumer; bot semantics already live in the message
layer via `isPending`/`isError`), NOT in `features/ai-assistant` — guard
layering forbids the component→feature import.

### AC-FE-MESSENGER-SURFACE — why extraction, not deletion (review F-1)

The Messenger scroll machinery is NOT dead: Messenger-INTERNAL setProps
(modal open/close, reply draft, member menu, search state, autoDownload
subscription) re-render the LIVE instance, and its
`planMessagesScroll('preserve')` restores the reading position after
those re-renders — the feed and the modals share one `.messenger`
element, and a Messenger re-render recreates the messages list at
scrollTop=0 with no scroll event. Only the store-driven half is dead
(the page store handler re-renders the page and detaches the live
Messenger before its own store handler runs). The extraction to
`feed-scroll.ts` keeps the preserve path byte-for-byte in effect and
gives the page engine (wave 2) the same source of scroll truth — disjoint
triggers, one memory, no racing maps.

### AC-FE-FEED-SCROLL — decision table in jsdom

jsdom has no layout: scrollTop/scrollHeight are plain writable props, so
the tests pin the DECISIONS (planned bottom vs restored saved top) and the
memory lifecycle (cleared on chat change, updated by the capture-sync
listener), not visual pixels — honest coverage of what jsdom can prove.
Frames are flushed between store emits; the 300ms echo-suppression window
keeps a simulated re-render reset from being recorded as a user scroll.

### AC-PROCESS — counts

Real base at the attempt line: mocha 568 (dev @ 7dbd7aa), eslint/stylelint
green, guard strict 0. The operator live smoke (mobile emulator tap-through
of /settings; an AI chat with a file answer showing the mock list; a long
chat send/receive autoscroll; the add-user modal focus) is a NOTE, not a
gate.
