# Plan 2026-11-04-mobile-back-deselect (quick-change, S1)

Operator request (2026-11-04, mobile bug): enter any chat → back to the chat
list → go to Contacts or Settings via the bottom bar → tap «Чаты» → you land
in the previously opened chat instead of the chat list.

## Root cause (verified in code)

The mobile pane state is DERIVED from the global store:
`chatPaneOpen: propsFromStore.selectedChat != null` (chat.ts:408). The mobile
back button only clears the LOCAL prop — `onBack` sets `chatPaneOpen: false`
(chat.ts:454-456) — while `selectedChat` keeps living in the Store. The next
mount of the chats page (bottom-bar «Чаты») re-derives `chatPaneOpen = true`
and reopens the old chat. Desktop is unaffected: the `chat_pane-open`
modifier only applies below 768px.

## Fix

`onBack` must clear the SELECTION in the store, not just the local prop: a
new `ChatsController.closeChatFeed()` (mirrors the existing
`store.set('selectedChat', undefined)` writes at controller.ts:374/764) called
from `onBack`. The page's existing CDU guard (chat.ts:631-636) collapses the
pane when `selectedChat` goes `defined → undefined`, so the local
`setProps({chatPaneOpen: false})` in `onBack` becomes redundant and is
replaced by the controller call. One test pin in chat.test.ts: back clears
`selectedChat` and the pane collapses; a fresh mount then shows the list.

Non-goals: no per-chat routes (`/messenger/:id`) — a separate optional
feature; no change to the bottom-bar return semantics without pressing back
(returning to an open chat after leaving via the bottom bar is the existing,
deliberate behavior that also powers the openDm flow from /contacts).

## Validation

`npm run verify` (mocha base 654 grows), guard strict 0. Evidence under
`work/2026-11-04-mobile-back-deselect/`.
