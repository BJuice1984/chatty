# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-1` | `REQ-BACKEND-SOCIAL` | `EV-BE-1` | `GET /api/v1/users?login=` returns matching users by login prefix (cookie auth, empty/case rules tested); `DELETE /api/v1/chats/{id}` removes the chat for the owner and refuses non-owners; both covered by integration pytest. |
| `AC-BE-2` | `REQ-BACKEND-SOCIAL` | `EV-BE-2` | Migration 005 adds `reactions` (unique message+user+emoji, fixed emoji set) and `messages.reply_to_id`; reactions set/toggle endpoint broadcasts a WS `reaction` event and the API returns reaction summaries with messages; `reply_to_id` is accepted on send and returned as `{id, user_id, snippet}`; pytest covers all of it; `verify:backend` green. |
| `AC-FE-1` | `REQ-FRONT-SOCIAL` | `EV-FE-1` | Header modals fully rebuilt: add-user modal with `@login` search (results list, add flow, feedback), delete-chat modal with confirmation; styled across 375/768/1280; component tests cover open/close/search/add/confirm flows. |
| `AC-FE-2` | `REQ-FRONT-SOCIAL` | `EV-FE-1` | Reactions: emoji picker per message, chips under bubbles with counts, own reaction highlighted, click toggles (optimistic update reconciled by the WS event); replies: reply action shows a quoted preview above the input, sent messages render the quoted block; component tests for both. |
| `AC-FE-3` | `REQ-FRONT-SOCIAL` | `EV-FE-2` | AI chats are visually distinct in the list (badge/icon) and the full P2P loop works live: user A finds user B by @login, adds them to a chat, both exchange messages with reactions and a reply; viewport receipts at 375/768 (no overflow, modals usable) plus screenshots. |

## Evidence contract

`EV-BE-1/2`: pytest + alembic receipts. `EV-FE-1`: verify receipt with the
new component tests. `EV-FE-2`: playwright receipts (P2P loop with two
sessions, reactions/reply DOM checks, modal geometry at 375/768) and
screenshots in the evidence folder. If the compose stack is unavailable,
EV-FE-2 is recorded as UNAVAILABLE and retried by the controller — never
substituted with prose; user B is ensured by login-or-register in the
script (idempotent).
