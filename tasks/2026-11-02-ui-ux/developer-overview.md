# Developer overview — 2026-11-02-ui-ux

## Intent

Four operator-reported UX defects of the messenger surface, one frontend-only
batch: (1) on mobile (<768px) every /settings sidebar item is a dead tap — the
right pane exists in markup but is unreachable in the one-column layout;
(2) a message attachment renders as the bare generic link «Вложение» — the
bot's found documents must be a readable file list (name + type icon +
«Скачать»), demonstrated with mock data while the bot is disabled;
(3) the message feed does not autoscroll — not on chat entry, not on send, not
on receive; (4) the add-user search modal never focuses its input on open and
loses focus when the typed text is fully cleared.

## User-visible result

- Mobile /settings: tapping any of the six items opens that section
  full-screen with a back control returning to the item list; desktop keeps
  the current two-column layout untouched.
- Attachments: every file message renders a compact file list inside the
  bubble — extension icon (pdf/xlsx/doc/generic), file name, «Скачать»
  button. Bot answers in AI chats show the mock document list (the bot is
  disabled; the mock module is explicitly marked for replacement).
- Feed: entering a chat lands at the newest message; sending a message and
  receiving a new one while reading the bottom scrolls down; reading history
  up is never yanked down by an incoming message; «загрузить ещё» keeps the
  reading position.
- Modals: the user-search input is focused the moment the modal opens, keeps
  focus with a caret while results re-render, and regains focus after the
  text is fully cleared — in both the messenger modal and the contacts modal.

## Architecture boundaries

- Layers only downward (`pages → components → controllers → api → utils`);
  guard `--all --strict` stays at 0. No component imports a feature or a
  controller; the mock attachment data therefore lives next to the message
  mapping in `components/messenger/` (bot semantics already live in the
  message layer: `isPending`, `isError`), not in `features/ai-assistant`.
- The STORE-DRIVEN scroll engine moves to the CHAT PAGE
  (`features/chats/pages/chat/`). Root cause of the dead autoscroll: every
  store emit re-renders the page and recreates the Messenger hbs-children
  without CDM/CDU, so the Messenger's store-driven scroll plans always land
  on a detached node, and the page's CDM scroll listener died with the first
  replaced node. The Messenger-INTERNAL preserve path is alive, though: the
  component's own setProps (modals, reply draft, member menu) re-render the
  live instance and restore the reading position — that machinery STAYS and
  is extracted (behavior-identical) into a shared module
  `components/messenger/feed-scroll.ts` (per-chat memory + one-time
  document-capture sync + plan helper). The page engine consumes the same
  module: one source of scroll truth, disjoint triggers (page reacts to
  store emits, Messenger to its own re-renders), no racing maps.
- Mobile pane switching reuses the existing root modifier `chat_pane-open`
  (chats page precedent) — CSS-only visibility, no new routing.

## Risks

- Scroll regressions across re-render cascades (multi-CDU per store emit —
  one FLOW_CDU per assigned prop key): mitigated by one coalesced rAF plan
  per frame and per-chat static memory; pinned-by-jsdom tests pin the
  decision table.
- Attachment UI replaces a pinned rendering contract («Вложение» tests in
  message/messenger suites) — the list-chat placeholders «Вложение»
  (last_message snippet, WS notifications) are a DIFFERENT surface and stay.
- No backend, migration, WS-protocol or store-shape risk. No new
  dependencies.

## Non-goals

- Real multi-attachment message contract (server-driven file lists when the
  bot returns) — the mock module is the marked seam.
- Image/media attachment previews and the autoDownload preview gate (no
  preview exists today; the preference stays for the future).
- «Найти все чаты», RAG carry-over, ai-assistant page restyle.
- Virtualized/infinite scroll; scroll restoration across full page reloads.

## Execution model

Three workstreams, two waves, single executing host (sequential), max
parallelism 1. The whole `components/messenger` + `components/message`
surface is ONE workstream (WS-FE-MESSENGER): the attachment mapping seam,
the modal focus handlers and the scroll-memory extraction all live in
`messenger.ts`, and the pinned «Вложение» render expectations live in
`messenger.test.ts` — the write-set cannot be split across waves. Wave 1:
WS-FE-SETTINGS-MOBILE ∥ WS-FE-MESSENGER (disjoint write-sets). Wave 2:
WS-FE-FEED-SCROLL (page engine + contacts focus + docs), after
WS-FE-MESSENGER. Evidence per task: `npm run verify` exit 0 with grown
mocha counts from the 568 base; final gate adds
`guard-architecture --all --strict`. Branch `feature/2026-11-02-ui-ux`
from dev `7dbd7aa`; PR target `dev`. The ALK-2.37.0 docs commit rides the
sibling branch `feature/2026-11-02-alk-update` and merges separately.
