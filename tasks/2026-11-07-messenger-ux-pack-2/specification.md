# Specification — 2026-11-07-messenger-ux-pack-2 (S2)

## Intent

Ten operator-reported messenger UX items collected on 2026-11-07 after live
use of the merged auth-session-ux contour. One plan, ONE frontend
workstream WS-ALL (decision D-2: the items' file sets overlap heavily —
chat.ts/hbs, chat.scss, messenger.scss, controller.ts serve 2-3 items
each), full ALK cycle on `feature/2026-11-07-messenger-ux-pack-2` from
`origin/dev @ 6eef4f0` (merge of PR #56).

1. **Mark-all-read icon rollback (feature stays).** The operator dislikes
   the CURRENT mark-all-read icon visual and asked to restore the old one
   "from main". Decision D-1: the SECOND header slot returns the
   branch-`main` VISUAL — `/images/settings-icon.svg` — while the
   mark-all-read FEATURE stays byte-identical (click → markAllRead, gating
   by hasUnread, disabled plumbing, action-describing alt). Git facts
   behind the decision: the feature was BORN with
   mark-all-read-icon.svg (f6e839d; the only later graphics change was a
   stroke-color fix in 6b690b0), so "the first version's own asset" would
   be a no-op; `main`'s slot-2 icon is exactly the settings gear the
   operator remembers.
2. **Chats-list loader.** While the chats list is being fetched (and the
   list is empty), the `chat__container-users-list` area shows an inline
   loader (three pulsing dots) instead of empty space.
3. **Avatar pencil underlay.** On the CHANGE-PROFILE avatar
   (`chat__container-profile-ava_type_change-profile`) the hover pencil is
   visible UNDER a translucent SVG avatar; add a colored underlay circle so
   the pencil sits on it and the avatar does not bleed through.
4. **Profile forms disabled until submittable.** "Submit changes" and
   "Change password" are disabled and unclickable while the form has no
   changes (values equal the seeded profile) OR any field fails
   validation. Enable live (per keystroke), not only on blur.
5. **Profile row is not clickable.** The main profile row
   (`chat__container-profile-img` inside `chat__container-profile-ava`)
   must not react to hover (no pencil/opacity), and the
   `chat__container-profile-arrow` chevron is removed. The change-profile
   variant in the Account pane keeps its affordances (item 3).
6. **Per-chat WS-death tint + "Чат недоступен" notice.** When a chat's
   socket dies by reconnect exhaustion (the existing wsDeadChats path),
   the chat row in the list tints RED respecting its style (user chat vs
   AI chat), entering that chat shows an error-style service bubble
   "Чат недоступен" (same visual family as the bot "Ассистент недоступен"
   bubble), and on socket recovery (Connected) the tint and the notice
   revert/disappear. Intentional closes (chat_deleted, leave, closeAll,
   reconnectAll drops) never tint.
7. **Disclaimer restyle + empty state with a create action.**
   `chat__disclaimer` ("Выберите чат…") is styled like the sibling hints
   (empty-chat-hint family). When the user has NO chats at all, the text
   becomes "Chatty: создайте чат с помощью кнопки <start-chat-icon image>
   либо нажмите создать" where "создать" is a button duplicating the
   one-click chat creation (createAndSelect) — same pattern as the
   empty-chat hint's "добавить".
8. **auto-title-hint chip.** The hint's text becomes the standard light
   token (today's `--secondary-text-color` is UNDEFINED in the repo — the
   chip text renders with no color of its own), and the chip becomes
   absolutely positioned, raised slightly above the title input (a slight
   overlap with the input is acceptable).
9. **AI badge always visible.** With very long titles the
   `chat-list-user__ai-badge` is clipped by the title's
   ellipsis+overflow. Restructure so the badge is always fully visible
   (its own flex item, never clipped), keeping single-line title
   truncation.
10. **Own-message sent checkmark.** Today nothing renders between WS send
    and the server echo (tens of ms, or seconds on a lagging server), and
    there is no sent marker at all. Add an optimistic own-message entry
    rendered with an in-flight indicator, replaced by the server echo;
    once the message carries a server id, the bubble shows a sent
    checkmark (single ✓ for own messages).

## Boundaries

- No backend changes; no WS protocol changes (the optimistic entry is
  replaced by content/user/chat matching on the echo — the server echo is
  authoritative; the temp entry never carries an id).
- Store additions are minimal: `chatsLoading?: boolean` on AppState
  (loader), a chats-slice local key for dead chat ids (cast-idiom like
  `chatSearch` — NOT a ChatInfo field, fetchChats replaces the array),
  and a client-only `ownTempId?: string` on Message for the optimistic
  entry (sibling of the existing client-only `isPending`/`isError`).
- The fullscreen busy-overlay semantics (refcount pairs) are untouched;
  the per-chat tint is strictly additive.
- Profile change-avatar affordances (item 3 target) stay; only the main
  profile row loses hover/chevron (item 5).
- No new npm dependencies; loader/checkmark visuals are plain SCSS.

## Non-goals

- read receipts / delivery-to-peer states (the checkmark means "accepted
  by the server", not "read")
- per-message retry UI for failed sends (an echo timeout still surfaces
  nothing new in non-AI chats — unchanged behavior)
- multi-line title truncation (single-line ellipsis stays)
- touching the reconnect overlay captions or connectivity watcher
- restoring the branch-`main` settings BEHAVIOR (the mark-all-read
  feature keeps its wiring; only the visual asset swaps — decision D-1)
