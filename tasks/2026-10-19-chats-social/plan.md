# Stage 16: chats-social

Two workstreams: WS-BACKEND-SOCIAL (phase A) then WS-FRONT-SOCIAL (phase B,
depends on A). Operator request 2026-10-19: rebuild the header modals fully,
@-login user search, chat deletion, user-to-user chats, emoji reactions on
messages, message quoting, and visually distinct AI chats.

## Phase A — WS-BACKEND-SOCIAL

1. `backend/app/api/v1/endpoints/users.py` (new router): `GET /users?login=`
   — cookie auth, case-insensitive login prefix match, own record excluded,
   capped result list (10), returns `{id, login, display_name}` where login
   is the full (lowercased) email — the login handle of the own contract —
   and display_name is DERIVED server-side as the email local-part with a
   full-email fallback (the User model has neither field; the derivation is
   part of this contract so both phases build against the same shape).
2. `DELETE /chats/{chat_id}` in `chats.py`: owner-only (403 otherwise);
   cascades messages/members/bot runs per FK rules; WS hub participants of
   that chat get a `chat_deleted` event (clients handle it in phase B).
3. (order with item 2) chat deletion sequence: broadcast `chat_deleted`
   over the hub FIRST (keyed by live sockets, reaches every connected
   member), THEN delete the row, THEN the server closes that chat's
   sockets (a hub close-chat method); the client closes its own chat socket
   on the event.
4. Alembic `005_reactions_replies`: table `reactions(id, message_id FK,
   user_id FK, emoji, created_at, unique(message_id, user_id, emoji))` and
   nullable `messages.reply_to_id FK messages.id ON DELETE SET NULL`
   (self-referencing; explicit ondelete per the codebase convention).
5. Reactions: `POST /chats/{chat_id}/messages/{message_id}/reactions`
   `{emoji}` — toggle (insert or delete), fixed server-side emoji set
   (👍 ❤️ 😂 😮 😢 🙏), membership-checked; response carries the new summary;
   the WS hub broadcasts `{type: 'reaction', content: {chat_id, message_id,
   user_id, emoji, active}}` to the chat.
6. Replies: `MessageCreate.reply_to_id` AND
   `WebSocketMessageContent.reply_to_id` (the WS send path validates
   through the same schema — without the duplicate field WS replies fail
   with invalid_event) — optional; must reference a message in the same chat; `MessageResponse.reply_to: {id, user_id, snippet} |
   null` (snippet = first 80 chars, computed server-side); the WS message
   broadcast carries it.
7. Reaction summaries ride along: `GET messages` pages and the WS `history`
   response include `reactions: [{emoji, count, mine}]` per message.
8. Tests: `backend/tests/integration/chat/test_social_api.py` (singular
   `chat/` per the existing tree — users search rules, delete policy + full
   cascade expectations incl. files/documents/chunks, reaction toggle + WS
   broadcast via the test hub, reply validation + snippet, summaries) and
   `backend/tests/unit/chat/test_reactions_repository.py`. `verify:backend`
   green.

## Phase B — WS-FRONT-SOCIAL (after A is accepted)

1. Ports/adapters: `searchUsers` (typed results), `deleteChat`,
   `setReaction(messageId, emoji)` (REST) + WS `reaction`/`chat_deleted`
   handling; `sendMessage` gains `replyToId`; `toMessage`/`toChatInfo` carry
   `is_ai`, `replyTo` and `reactions`; controller methods for all of it.
2. Header modals rebuilt (`messenger.hbs` + a new modal layer component):
   add-user modal with an `@login` search input (debounced search via
   `searchUsers` while the user types after `@`), result list, add action
   with feedback; delete-chat modal with a typed/click confirmation; both
   closable (backdrop/Escape), styled at 375/768/1280 on the stage-15
   adaptive base; the current inline `FormContainer` hack retires.
3. Reactions UI — ONE entry mechanism for both device classes: an
   always-in-DOM affordance (a small reactions button on the bubble)
   revealed by CSS `:hover` on `pointer: fine` devices and permanently
   visible on touch; a click/tap opens the fixed emoji set; NO JS
   long-press timers; chips under the bubble (emoji + count, own highlighted); click
   toggles optimistically, reconciled by the WS event; hidden on the
   chat-history status row.
4. Replies UI: a reply action on a bubble sets the reply draft (quoted
   preview above the input, closable); sending attaches `reply_to_id`;
   bubbles render the quoted block (author + snippet, quoted styling);
   NaN-safe like all message fields.
5. AI chat distinction: `ChatInfo.is_ai` from the adapter; the chat list
   renders a badge (✦ + «AI») and an accent on AI chats; bot bubbles keep
   the theirs side.
6. `chat_deleted` WS event: the open chat pane resets to the list with a
   toast/text; the chat disappears from the list on the next fetch.
7. Tests: component tests for modals (open/close/search/add/confirm),
   reactions (chips/toggle/own-highlight), replies (preview/quoted block),
   AI badge; existing 203 stay green.
8. Live P2P evidence: two sessions (user A = smoke account, user B ensured
   by login-or-register — idempotent), A finds B by @login, adds to a new chat, both send messages, A
   reacts and replies; viewport receipts at 375/768 (modals usable, no
   overflow) + screenshots.

Verification: `npm run verify` (frontend), `PYTHON_BIN=… npm run
verify:all`, compose preflight, guard strict, live P2P receipts.
