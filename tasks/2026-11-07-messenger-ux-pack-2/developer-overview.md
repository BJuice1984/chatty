# Developer overview — 2026-11-07-messenger-ux-pack-2

Baseline `origin/dev @ 6eef4f0`. ONE frontend workstream WS-ALL (decision
D-2 — the items overlap on chat.ts/hbs, chat.scss, messenger.scss,
controller.ts); the groups below are implementation batches inside that
single task. Research facts are file:line-verified at 8bc75e3 (same
content as the merged PR #56).

## WS-DEAD (item 6) — per-chat tint + «Чат недоступен»

Existing plumbing (verified): controller `wsDeadChats` Set
(controller.ts:179-183) fed by `handleWsDied`/`handleWsReconnected`/
`forgetWsDeath` (:576-609) via gateway `notifyWsUnexpectedClose/Connected`
(adapter marks intentional closes in `intentionalCloses`, own.ts:187-193,
350-361; Connected resets and re-requests history, :207-218). Missing:
surfacing to the UI.

Build:
1. Chats slice gains a local dead-set view: `store.set('wsDeadChats',
   [...ids])` cast-idiom (precedent `chatSearch`, chats/store.ts:56 —
   AppState untouched OR an optional AppState field; the array form keeps
   the slice JSON-comparable). handleWsDied adds + publishes,
   handleWsReconnected/forgetWsDeath remove + publish (empty array when
   none).
2. Row: withChats (chat.ts:742-774) passes `isDead={dead.has(id)}`;
   chatListUser.hbs adds `chat-list-user_dead` (after `_ai` so it can
   override); chat-list-user.scss `_dead` red tint composed with `_ai`
   (AI rows keep their badge/star but take the red border/background
   tint) and with `_archived` (dead wins on opacity). Tests mirror the
   `_archived` describe (chatListUser.test.ts:40) and the page-level
   end-to-end (chat.test.ts:505).
3. Notice: synthetic Message exactly like the bot-error precedent
   (controller.ts:754-768): `{chat_id, time: now, type:'message',
   user_id:-1, content:'⚠ Чат недоступен', isError:true,
   isChatUnavailable:true}` — new client-only flag `isChatUnavailable?:
   boolean` on Message (sibling of isPending/isError, types.ts:219-225).
   Pushed in `selectChat` when the chat is dead (controller.ts:950-978)
   and in `handleWsDied` when the dead chat is currently selected;
   `handleWsReconnected`/`forgetWsDeath` filter it out (pattern:
   dropPending :746-752). Existing ws-death tests (chats.test.ts:1459
   describe) grow: tint publish/retract, notice on open, notice removal
   on recovery, NO tint/notice for intentional closes.

## WS-UI (items 1,2,3,5,7,8,9) — messenger/list cosmetics

1. **Icon rollback (decision D-1)**: headerIcons.ts second entry's src →
   '/images/settings-icon.svg' (the branch-`main` VISUAL; the file
   exists, readOnly). Feature plumbing byte-identical: onClick
   markAllRead, hasUnread gating, disabled plumbing, action-describing
   alt. headerIcons.test.ts re-pins the src (today it expects
   mark-all-read-icon.svg — 3 tests). mark-all-read-icon.svg stays
   untouched (rollback hint: 6b690b0^ stroke revert if the operator
   later means the early black version).
2. **List loader**: `chatsLoading?: boolean` on AppState (field only —
   authLoading precedent); controller fetchChats sets true at entry and
   false in finally; withChats maps it; chat.hbs renders, when
   `chatsLoading && chats.length===0`, a `<li class="chat__list-loading"
   data-testid="chats-loading" role="status">` with three
   `chat__list-loading-dot` spans; chat.scss keyframes pulse (zero
   comments). Search mode is NOT loading — the flag only tracks the
   initial fetch cycle.
3. **Pencil underlay (change-profile avatar)** — concrete shape (review
   F-5: a pseudo-element cannot paint BELOW the container's own
   background): `_type_change-profile` carries TWO background layers —
   the pencil svg first, a colored circle (radial-gradient of an
   overlay-token color, centered, covering the pencil zone) second — so
   the fading avatar img no longer bleeds through under the pencil.
   Hover keeps the img fade as today.
5. **Profile row de-hover + chevron removal**: profile.hbs drops the
   `chat__container-profile-arrow` img (line 14); the root
   `.chat__container-profile` row loses its hover affordance — scope: the
   MAIN row only. Implementation: chat.scss `&-img:hover` and the
   pencil background move under `_type_change-profile` context (the
   change-profile variant keeps everything); simplest robust shape: gate
   the pencil/opacity rules with `:not()` or nest them under the
   change-profile modifier. The arrow SCSS block (282-288) is removed
   with the markup.
7. **Disclaimer**: messenger.hbs else-branch grows a second state —
   `{{#if hasNoChats}}` renders the create variant: text "Chatty:
   создайте чат с помощью кнопки" + inline `<img class="chat__header-icon"
   src="/images/start-chat-icon.svg">` + text "либо нажмите" + button
   `data-testid="disclaimer-create"` "создать" (empty-hint-button visual
   family, messenger.scss:29-71); click delegation in messenger.ts
   (precedent empty-chat-add :557-564) → `onCreateChat` prop → chat.hbs →
   chat.ts `() => { void ChatsController.createAndSelect() }` (precedent
   header onClick :443-450). `hasNoChats = !chatsLoading && chats.length
   === 0` from withChats. Both disclaimer variants styled in the
   empty-hint text family (centered, --main-text-color text for the
   primary line).
8. **auto-title-hint**: messenger.scss:73-84 — color switches to the
   DEFINED standard light token `--second-text-color` (today's
   `--secondary-text-color` is undefined repo-wide — bug-fund); chip
   becomes `position: absolute` raised above the input (slight overlap
   allowed; pick top/right offsets that clear the header layout).
9. **ai-badge**: chatListUser.hbs — badge moves OUT of the truncating
   `__title` h4; `__container-content` header line becomes a flex row:
   title span (`min-width: 0` + the existing ellipsis rules moved/kept)
   + badge span (`flex: 0 0 auto`). No content changes; tests assert
   badge presence for ai rows and plain rows (existing describe) + NEW:
   long title does not clip the badge (assert badge offsetWidth/parent
   overflow logic in jsdom terms — assert it is a flex sibling, not
   inside the h4).

## WS-FORMS (items 4,10) — profile buttons + sent checkmark

4. **Disabled until submittable** (decision D-7, review F-4 documented):
   ProfilePage constructor creates BOTH submit buttons with `disabled:
   true` (Button renders the attribute — plumbing exists end to end). A
   delegated `input` listener on the page root (events.input) recomputes
   per keystroke WITHOUT re-render: dirty = serialized values differ from
   the seeded user values (display_name/phone; the password form is
   dirty when any of its three fields is non-empty); valid = every
   input's validate() passes AND, for the password form, new===repeat.
   The listener sets `button.disabled` imperatively via
   `this.element.querySelector(...)`. KNOWN RESET SEMANTICS (review
   F-4): the page is withStore-wrapped and every store emit re-renders
   it — registerComponent rebuilds Form/Inputs/Buttons, _setProfile
   reseeds the values, and the buttons come back from their descriptor
   (disabled:true) in the SAME render, so the state is self-consistent;
   an in-progress edit (draft + enabled button) is wiped by a background
   emit exactly like the input drafts are TODAY (pre-existing behavior)
   — the user retypes and the listener re-enables. render() needs no
   special seeding beyond the descriptor's disabled:true. Tests: initial
   disabled both; valid change enables; revert-to-seed disables; invalid
   phone keeps disabled; password gating (old non-empty + new valid +
   repeat match); PLUS the F-4 pin — a store emit mid-edit reseeds
   inputs AND returns the button to disabled (never leaves an enabled
   button over reseeded inputs).
10. **Sent checkmark**: optimistic own entry + echo replace + ✓ marker.
    - DTO: `ownTempId?: string` (client-only, crypto.randomUUID() or a
      counter — plan: nanoid already a dependency? use a simple module
      counter `tmp-${n++}`; uniqueness per session suffices).
    - controller.sendMessage (controller.ts:647-676): BEFORE the WS
      send, append `{chat_id, time: now, type:'message', user_id: me,
      content, ownTempId}` to `messages.${chatId}` (one store emit); the
      AI path's pending tail and waitForOwnEcho are unaffected (temp has
      no numeric id; knownIds snapshot taken BEFORE the append still
      excludes it).
    - ws Message handler (own.ts:220-245): replace condition (review F-3
      — the adapter HAS the viewer id: store.getState().user?.id is used
      at own.ts:82 and :162) = incoming user_id === viewer id AND an
      ownTempId entry exists for that chat; the OLDEST such temp is
      replaced with the server message in the same store emit. Content
      equality is NEVER the primary matcher (another member sending the
      same text must not consume a pending own temp); among MULTIPLE own
      temps it may serve as a tie-breaker only. The server-id dedup
      check stays untouched.
    - messageCacheKey (messenger.ts:46-52): `ownTempId` →
      `owntmp:${ownTempId}` (instance reuse across re-renders while in
      flight).
    - message.hbs: own bubbles render the marker — temp entry
      `isSending` state (a `messenger__message-status` span with a
      pulsing dot / "…" ) and, for own messages WITH a numeric id, a
      single "✓" (messenger__message-status_sent). Non-AI and AI chats
      alike (the AI pending tail is a different element and unchanged).
    - Tests: controller — temp entry appended on send, replaced (not
      duplicated) by the echo with the server id; ws adapter — echo
      replaces the oldest temp of that chat; message component — ✓ for
      own+id, in-flight marker for temp; messenger mapper — owntmp key.

## Gates

`npm run verify` green with mocha grown from the 733 baseline; guard
`--all --strict` 0; progress_log record on top; conventional commits, no
co-author trailers.

## Risks

- Item 1 residual: the operator may have meant the EARLY black
  checkmark rather than the main-branch gear (D-1 chose the literal
  "look in main" reading); the rollback is a one-line stroke revert in
  mark-all-read-icon.svg (6b690b0^) if so — journaled in decisions.md.
- Item 10: identical own texts sent in quick succession resolve FIFO by
  the oldest-temp rule; the viewer-id gate keeps a foreign same-text
  message harmless (F-3) — pinned by the foreign negative test.
- Item 4 imperative disabled toggling bypasses Block re-render — pinned
  by tests (incl. the F-4 reseed pin) so a future form refactor notices.
