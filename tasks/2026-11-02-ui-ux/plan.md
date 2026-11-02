# Plan — 2026-11-02-ui-ux

Four UX defects, frontend-only, base `dev` @ `7dbd7aa` (mocha 568, eslint +
stylelint + guard strict green). Clarification log (operator, 2026-11-02):
autoscroll — entry and own send ALWAYS go to the bottom, an INCOMING message
scrolls down only when the viewer is already reading the bottom (standard
messenger UX, operator-confirmed); bot attachments — mock list applies to
bot answers in AI chats (operator-confirmed); branch
`feature/2026-11-02-ui-ux` from dev; plan id `2026-11-02-ui-ux`.

## WS-FE-SETTINGS-MOBILE — mobile pane navigation for /settings

Root cause: `profile.hbs` renders the same two-column `.chat` layout as the
chats page, but the mobile media block in `chat.scss` (max-width <768) only
defines pane switching for `chat__container-chats`; `chat__container-profile-changing`
has no mobile rule, so in the one-column grid it is clipped away — taps on
the six items change `section` in an invisible pane.

1. `src/features/profile/pages/profile/profile.ts` — controller-free UI
   state `settingsPaneOpen: boolean` (default false). All six `onSelect*`
   handlers set `{section, settingsPaneOpen: true}` (one shared
   `selectSection` stays; the pane flag is additive). New
   `onSettingsBack: () => setProps({settingsPaneOpen: false})`. The flag is
   inert on desktop (no CSS applies ≥768).
2. `src/features/profile/pages/profile/profile.hbs` — root
   `class="chat{{#if settingsPaneOpen}} chat_pane-open{{/if}}"`; a back
   button `<button type="button" class="settings-section__back"
   data-testid="settings-back" aria-label="Назад к настройкам">` as the first
   child of `.chat__container-profile-changing` (outside the section `{{#if}}`
   blocks, so it shows for every section).
3. `src/scss/components/chat.scss` — mobile block additions:
   `&__container-profile-changing { display: none; }` and
   `&_pane-open &__container-profile-changing { display: flex; }` (the
   existing `&_pane-open &__container-users { display: none; }` already
   covers hiding the sidebar; the existing
   `&_pane-open &__container-chats` rule is irrelevant — the settings page
   has no such child). No comments in scss.
4. `src/scss/components/settings-sections.scss` — back-button styles after
   the `messenger__back` precedent: `display: none` desktop-first,
   `inline-flex` + chevron `::before/::after` inside `@media (max-width:
   ($tablet - 1px))`. Zero comments.
5. `src/features/profile/pages/profile/profile.test.ts` — new describe:
   tapping EACH of the six items adds `chat_pane-open` to the root and
   renders that section's `data-testid="settings-section-*"`; the back
   button removes the modifier and keeps the current `section` (returning to
   the same section re-opens instantly); desktop section switching (the
   existing `settings page sections` describe) stays green unchanged.

## WS-FE-MESSENGER — messenger component surface (wave 1)

One owner for the whole `components/messenger` + `components/message`
surface — the write-set cannot be split across waves: the attachment
mapping seam, the modal focus handlers and the scroll-memory extraction
all live in `messenger.ts`, and the pinned «Вложение» render expectations
live in `messenger.test.ts`.

### Attachments: file-list with icons + marked mock bot data

Today `message.hbs` renders any `fileUrl` as one generic link («Вложение»,
or «Скачать» when `autoDownload === false`). Replace with a file list; the
bot's RAG answer documents become a multi-item list from a marked mock
(bot disabled — operator instruction).

1. `src/utils/types.ts` — `export interface MessageAttachment { name:
   string; url: string }`; `Message.attachments?: MessageAttachment[]`
   (additive; `file_url`/`file` stay for the list-snippet and mapping
   seams).
2. `src/components/message/message.ts` — icon kind from the name extension:
   `pdf` | `xlsx` (xls/xlsx) | `doc` (doc/docx) | `generic`; computed per
   attachment into `icon` for the template. No other behavior change.
3. `src/components/message/message.hbs` — replace the single-link block
   with `{{#if attachments}}` → `<ul class="messenger__message-files">`,
   each item: icon `<img src="/images/file-{{this.icon}}.svg" alt="">`,
   `<span class="messenger__message-file-name">{{this.name}}</span>`
   (double-brace — server/mock names are untrusted text), `<a
   class="messenger__message-file-download" href="{{this.url}}" download
   data-testid="attachment-download">Скачать</a>`. The `autoDownload`
   branch is retired from the template (no preview exists to gate; the
   preference itself stays for future previews — settings hint text is
   unaffected: it promises a «Скачать» fallback, which the list now always
   provides).
4. `src/components/messenger/bot-attachments.mock.ts` (new) —
   `MOCK_BOT_DOCUMENTS: { name }[]` (e.g. «Заявление на отпуск.pdf»,
   «Бюджет отдела 2026.xlsx», «Инструкция по отчётам.docx») and
   `mockBotAttachments(url: string, realName?: string):
   MessageAttachment[]` — first item keeps `realName` when present, every
   item points at the real `url`. Loud header: MOCK — delete together with
   its call site when the bot returns real found-file lists.
5. `src/components/messenger/messenger.ts` — in `withMessenger`/`mapTypedMessages`
   seam: a message with `fileUrl` gets `attachments`; when
   `chatInfo?.is_ai === true` AND the message is incoming (`!isMine`) the
   list is `mockBotAttachments(fileUrl, file?.filename)`; otherwise a
   single `{name: file?.filename ?? 'Файл', url: fileUrl}`. Honest naming
   note (review F-2): NO adapter populates `Message.file` at runtime today
   (the WS adapter maps file_id → file_url only), so `file.filename` is
   exercised by unit fixtures alone and every real non-AI file message
   renders the «Файл» fallback; runtime bot names come from the mock set
   until the backend contract carries real names.
6. Icons — `public/images/file-pdf.svg`, `file-xlsx.svg`, `file-doc.svg`,
   `file-generic.svg` (24×24, currentColor, sheet-style glyph + extension
   label; no external assets).
7. `src/scss/components/messenger.scss` — `.messenger__message-files` rows
   inside the bubble: 20px icon, ellipsized name, text-button «Скачать»;
   light/dark via existing tokens only. Zero comments.
8. Tests — `message.test.ts`: list renders items (icon src per kind incl.
   docx→doc and unknown→generic), name is escaped (XSS probe), href +
   `download` attribute, no list without attachments; the old
   «Вложение»/«Скачать» link expectations are replaced.
   `messenger.test.ts`: mapping rule — AI chat + incoming + fileUrl → mock
   list (3 items, first named from `file.filename` when present), own
   message in an AI chat → single real item, non-AI chat → single item, no
   file → no attachments; the pinned «Вложение» feed-render expectations
   (messenger.test.ts ~875/890) are updated to the list UI. The
   «Вложение» placeholders of the chat LIST and notifications
   (`chats/api/own.ts`, `chats/ws/own.ts` + their tests) are a different
   surface — untouched.

### Modal focus (messenger half, same workstream)

The cross-button handler resets `addUserQuery: ''` on open (stale-query
bug) and focuses `[data-testid="user-search-input"]` in the next frame
(reuse `refocusSearchInput`); the empty-query branch of the `input`
handler refocuses after its immediate `setProps` re-render; the debounced
response branch keeps the existing refocus. Tests: modal open focuses the
input (query cleared); fully clearing the text keeps focus.

### Scroll-memory extraction (same workstream; behavior identical)

The Messenger scroll machinery is NOT dead and stays: Messenger-INTERNAL
`setProps` (modal open/close, reply draft, member menu, search state,
autoDownload subscription) re-render the LIVE instance, and its
`planMessagesScroll('preserve')` is what restores the reading position
after those re-renders (the feed and the modals share one `.messenger`
element — messenger.hbs recreates the messages list at scrollTop=0 with
no scroll event; review F-1). Only the STORE-driven half is dead: the
page store handler re-renders the page and detaches the live Messenger
before the Messenger's own store handler runs (subscription order), so
store-driven Messenger plans always land on a detached node.

This wave therefore only EXTRACTS the scroll state into a shared module —
new `src/components/messenger/feed-scroll.ts`: the per-chat memory
`Map<chatId, {top, pinned}>`, the one-time document-capture
`installScrollSync` (class guard `messenger__container`, 300ms
echo-window suppression, `pinned` within 120px) and the small
plan/coalesce helper. `messenger.ts` sources all of it from the module
(refactor, zero behavior change; the Messenger CDU preserve path stays
byte-for-byte in effect). The page engine in WS-FE-FEED-SCROLL consumes
the same module (pages→components is a legal downward import), so both
writers share one source of scroll truth instead of racing two maps.

`messenger.hbs` keeps passing `autoDownload` to Message (line 22): the
prop stays reserved for future previews even though message.hbs no longer
branches on it (review F-3 — recorded decision, no template churn).

## WS-FE-FEED-SCROLL — page-owned autoscroll engine + contacts focus + docs (wave 2, after WS-FE-MESSENGER)

Root cause of the dead autoscroll: every store emit re-renders the page
(`withChats` always returns a fresh `chats` array) and recreates the
Messenger hbs-children WITHOUT CDM/CDU (Block dispatches CDM once per
instance, on the initial mount tree only), so the Messenger's scroll plans
never ran on the live node; the page's own scroll listener attaches in CDM
to a node that the first re-render replaces; and the page CDU branch
`newLen > oldLen` compares `messages` which the page mapper never maps in —
always 0/0, so it falls to «restore saved top» and leaves the feed where
the empty pane was.

1. `src/features/chats/pages/chat/chat.ts` — page-owned scroll engine on
   the SHARED module from WS-FE-MESSENGER (`components/messenger/feed-scroll.ts`
   — pages→components is a legal downward import):
   - the engine consumes the shared per-chat memory + the one-time
     document-capture sync installed by the module (class guard
     `messenger__container`, 300ms echo-window suppression, `pinned`
     within 120px) — this replaces the page's per-node CDM scroll
     listener, which dies with the first replaced node; the page's dead
     CDU branch comparing never-mapped `messages` (always 0/0) is deleted
     in favor of the store-read decision below.
   - CDU decision read from the STORE (the page mapper has no `messages`):
     chat change (per-write oldProps selectedChat) → delete that chat's
     memory + plan bottom; tail growth (length grew with the head id
     unchanged — append, not «загрузить ещё» prepend) AND (pinned OR the
     last message `isPending` — the typing placeholder always pins) → plan
     bottom; everything else (prepend, reactions, drafts, unrelated
     re-renders) → plan restore of the saved top. One coalesced rAF plan
     per frame (the module's plan helper) applied to the live
     `.messenger__container` — the last CDU of the cascade wins; the
     Messenger-internal preserve plans (modal/draft/menu re-renders) keep
     working through the same module and never fight the page engine
     (disjoint triggers, one memory). Helper contract (review F-5): the
     module owns the memory, the document-capture sync and the plan
     RESOLUTION values only — each caller (page instance, Messenger
     instance) keeps its own rAF coalescing and applies its plan to its
     OWN element (`this.element` query), never a module-global plan slot
     or a document-resolved target: zombie Messenger instances (hbs
     children are replaced without destroy) keep firing plans on store
     emits, and per-caller resolution makes those no-ops against their
     detached elements instead of displacing the page engine's bottom
     plan.
   - CDM keeps the entry-with-selectedChat bottom scroll (openDm return).
   - `pinnedToBottom` instance field is superseded by the shared memory.
2. `src/features/contacts/pages/contacts/contacts.ts` — mirror for the
   contacts add-modal: focus on open (next frame) + refocus on the
   empty-query branch (it already refocuses after search responses).
3. Tests — `chat.test.ts`: decision table (chat change → bottom + memory
   cleared; append while pinned → bottom; append while NOT pinned → saved
   top; head-changed growth (prepend) → saved top, never bottom; pending
   tail → bottom even when unpinned) via store-driven re-renders with
   flushed animation frames; `contacts.test.ts`: open focuses the input.
4. Docs — `docs/NEXT.md` record + `docs/progress/progress_log.md` entry on
   top (what/why/verified, mock-removal pointer for the attachments).

## Out of scope

Real bot multi-file contract; image previews / autoDownload preview gating;
«Найти все чаты»; scroll preservation across reloads; ai-assistant page
restyle; any backend change (`backend/**` is a forbidden write).

## Evidence

Per task: `npm run verify` (typecheck → mocha → eslint → stylelint) exit 0
with counts grown from the 568 base. Final: plus
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict` = 0.
Operator live smoke (NOT a gate): mobile emulator /settings tap-through;
open an AI chat with a file answer (mock list visible); send/receive in a
long chat; open the add-user modal.
