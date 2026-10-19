# Stage 15: chat-ui-polish

Single workstream WS-CHAT-UI. Today: `isMine` only right-aligns text; `time`
is not rendered; there are zero `@media` queries in the project; the chat
screen is a fixed 375px sidebar + pane grid.

1. `src/scss/utils/variable.scss`: breakpoint tokens (`$tablet: 768px`,
   `$desktop: 1024px`) + bubble palette tokens.
2. `src/components/message/message.ts` + `message.hbs`: props
   `time?: string`, `showDate`; a day-marker block above the bubble when
   `showDate`; HH:MM formatted from the existing ISO `time` (pure view
   formatting — helper or inline, locale `ru-RU`); bubble markup: mine/theirs
   modifier on the `li`, time inside the bubble tail. **NaN safety:**
   `Intl.DateTimeFormat.format(new Date(NaN))` throws RangeError — one bad
   `time` would kill the whole messenger render. The formatter and the day
   computation must treat an invalid/empty `time` as absent: render without
   the time and without the day marker, never throw (test fixtures like
   `time: 't'+id` exist in ws.test.ts and must keep rendering).
3. `src/components/messenger/messenger.ts`: extract the inline mapping
   into a named `mapTypedMessages`; it gains `showDate` (true on the first
   message of a day, comparing consecutive `time` values) and passes `time`
   through. **Wiring is part of the item:** `messenger.hbs` must pass
   `time=this.time showDate=this.showDate` in the `{{#each messages}}`
   Message call — today only content/user_id/isMine/fileUrl reach the
   helper, and without this edit the whole stage silently never renders.
4. Mobile switch — full mechanics: state `chatPaneOpen: boolean` lives in
   `ChatPageBase` (default `false`); any chat selection — including a repeat
   click on the same chat, `chatListUser` always fires onSelect — sets it to
   `true`; the back control sets it to `false`. Transitions are closed: with
   the pane open (<768px) the list is CSS-hidden so no chat clicks are
   possible; `selectedChat` in the store lives independently, so re-selecting
   after back opens the pane with live data; a chat change with the pane
   closed is impossible (the list is only visible when the pane is closed);
   after delete-chat the pane stays open with the disclaimer — acceptable.
   Wiring for the back callback (the Messenger constructor whitelists its
   props, LIVE-7 lesson): `chat.ts` handler `setProps({ chatPaneOpen: false })`
   → passed as `onBack` in the `chat.hbs` Messenger call → added to the
   `MessengerBase` constructor whitelist → a header back button in
   `messenger.hbs`, hidden by default and shown only in the <768px branch
   (the stylesheet is desktop-first). No router/store changes.
5. `src/scss/components/messenger.scss`: bubble styles — sides via
   per-item modifiers on `messenger__container-message` (`align-self:
   flex-end/flex-start` under `&_mine`/`&_theirs`), backgrounds, radii,
   max-width, the time and day marker styling. **Scope guard:** the message
   list also hosts the self-registering `li.chat-history` status row — no
   bare `li` descendant selectors, no `align-items`/`gap` changes on the
   `messenger__container` itself; `li.chat-history` must stay visually
   unchanged.
6. `src/scss/components/chat.scss`: responsive layout — tablet (sidebar
   narrower, paddings compact), mobile (<768: single column; the modifier
   class shows the chat pane and hides the list; back control visible);
   `@media (min-width: $tablet)` / `(max-width: ...)` with mobile-first or
   desktop-first consistent with the file's existing style — pick one and
   keep it.
7. Tests: `src/components/message/message.test.ts` (new) — mine/theirs
   modifier, HH:MM rendering, day marker only when `showDate`, and the
   invalid-time case (no time, no marker, no throw);
   `src/components/messenger/messenger.test.ts` — showDate on day change;
   update `chat.test.ts` if the constructor/props change.
8. Evidence: `npm run verify`; playwright receipts at 375/768/1280 —
   geometry assertions (own bubble center > viewport center, theirs <,
   `document.scrollingElement.scrollWidth <= innerWidth` at 375/768, mobile
   switch: select chat → pane visible/list hidden → back → list visible),
   screenshots to the evidence folder.

Verification: `npm run verify`, `npm run stylelint`, guard strict, live
viewport receipts.
