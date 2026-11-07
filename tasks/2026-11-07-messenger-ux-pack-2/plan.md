# Plan — 2026-11-07-messenger-ux-pack-2

Operator's ten messenger-UX items of 2026-11-07 (after PR #56 merged),
full ALK cycle on `feature/2026-11-07-messenger-ux-pack-2` from
`origin/dev @ 6eef4f0`. Research file:line facts live in
developer-overview.md; operator pre-authorized execution (session
message) and delegated blocker resolution to the controller — every
such decision is journaled in decisions.md. ONE frontend workstream
WS-ALL owns the whole write-set (decision D-2: overlapping file sets);
the sections below are implementation GROUPS inside that single task.

## Group UI — cosmetics of the chat list, header, profile row (items 1,2,3,5,7,8,9)

- ICON: second header slot src → /images/settings-icon.svg (branch-main
  VISUAL per D-1; the file exists, readOnly); feature plumbing
  byte-identical (onClick markAllRead, hasUnread gating, disabled,
  action-describing alt); headerIcons.test.ts re-pins the src (today it
  expects mark-all-read-icon.svg); mark-all-read-icon.svg untouched.
- LOADER: AppState `chatsLoading?: boolean` (field only);
  fetchChats true→finally-false; withChats maps; chat.hbs renders
  li[data-testid=chats-loading] (role=status, three pulsing dots) when
  loading && list empty; chat.scss keyframes (zero comments). Search
  mode never shows it.
- AVATAR underlay: `_type_change-profile` gets a colored circle underlay
  (overlay-token family) so the hover pencil stops bleeding through
  translucent SVG avatars; z-order img < underlay < pencil.
- PROFILE ROW: remove `chat__container-profile-arrow` (markup + scss
  block); the MAIN profile row loses hover affordance — pencil/opacity
  rules scoped to the change-profile modifier only.
- DISCLAIMER: two states in messenger.hbs else-branch — default
  «Выберите чат…» and, when `!chatsLoading && chats.length===0`, the
  create variant with the inline start-chat icon image + button
  «создать» (data-testid=disclaimer-create, empty-hint-button visual
  family); click delegation in messenger.ts (empty-chat-add precedent)
  → onCreateChat → chat.ts → ChatsController.createAndSelect(). Both
  states styled in the empty-hint text family.
- HINT: auto-title-hint color → defined `--second-text-color`
  (undefined-variable bug-fund closed; grep pin no
  `--secondary-text-color`); chip position:absolute raised above the
  title input (slight overlap allowed).
- BADGE: ai-badge leaves the truncating h4 — flex row (title
  min-width:0 + ellipsis, badge flex:0 0 auto); single-line truncation
  kept; modifier tests extended + new "long title does not clip the
  badge" pin.

Gate: npm run verify green, mocha grown from 733.

## Group WS-DEAD — per-chat ws-death tint + «Чат недоступен» (item 6)

Controller publishes its existing wsDeadChats set to a chats-slice key
(cast-idiom array; NOT a ChatInfo field — fetchChats replaces the
array): handleWsDied/handleWsReconnected/forgetWsDeath own the
transitions. Rows: withChats passes isDead → `chat-list-user_dead`
modifier composed with `_ai`/`_archived` (dead visually wins). Notice:
synthetic Message «⚠ Чат недоступен» (isError, isChatUnavailable client
flag, user_id -1 — exact bot-error precedent) pushed IDEMPOTENTLY in
selectChat for a dead chat (only when no isChatUnavailable entry exists
yet — repeated opens never stack bubbles; review F-6) and in handleWsDied
for the open chat; removed on recovery via the dropPending pattern.
Intentional closes never tint/notify (existing adapter marks). Tests
extend the ws-death describe + modifier tests + page-level row test +
the double-open idempotency pin.

## Group FORMS — profile submit gating + sent checkmark (items 4,10)

- FORMS: both profile submit buttons start `disabled: true`; a
  delegated page-level `input` listener recomputes dirty+valid per
  keystroke and toggles the button attributes imperatively (NO re-render
  per keystroke — focus/drafts untouched); dirty for the account form =
  differs from seeded display_name/phone; for the password form = any
  field non-empty; valid = every validator passes AND new===repeat.
  Reset semantics per F-4 (store emit reseeds form+buttons
  consistently); render needs no seeding beyond the descriptor's
  disabled:true. jsdom tests pin enable/disable transitions + the
  reseed pin for both forms.
- CHECK: optimistic own message — controller.sendMessage appends a temp
  entry (client-only `ownTempId`, module-counter ids, replyTo carried
  when replying) before the WS send; the ws Message handler replaces
  the OLDEST temp of that chat when incoming user_id === viewer id
  (content never the primary matcher — foreign same-text is harmless;
  tie-breaker among own temps only) with the server message in one
  store emit; messageCacheKey gains `owntmp:<id>`; message.hbs renders
  an in-flight marker for temps and a single «✓» for own messages with
  a server id; AI pending tail untouched; waitForOwnEcho unaffected
  (temp has no numeric id). Tests: controller append/replace, adapter
  viewer-id-gated replace (+ foreign negative), component markers,
  mapper key.

Gate: npm run verify green; guard strict 0.

## Sequencing

Single task WS-ALL executes the three groups in order UI → WS-DEAD →
FORMS (convention only — the write-set is one). Progress-log record +
decisions journal maintained by the controller. One PR to dev after the
final audit.
