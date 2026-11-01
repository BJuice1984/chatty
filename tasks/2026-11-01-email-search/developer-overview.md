# Developer overview — 2026-11-01-email-search

## Intent and user-visible result

Typing a user's FULL email (`alice@chatty.local`) into either add-user
modal finds the user. Today both modals strip every `@` from the input
before the debounced prefix search, so the full address degenerates to
`alicechatty.local` and the result list stays empty; users must know to
type a bare prefix. After the fix the search accepts both the prefix and
the full address, and the in-modal hint says so.

## Architecture map

Frontend-only, two input handlers and one HTML hint:

- `src/components/messenger/messenger.ts` — the `@`-strip block inside
  the root-delegated `input` handler (search input
  `[data-testid="user-search-input"]`) and the hint string inside
  `renderAddUserModalContent` (shared by BOTH modals — the contacts page
  reuses the builder, so the hint changes in one place).
- `src/features/contacts/pages/contacts/contacts.ts` — the mirrored
  `@`-strip block in the page's own `input` handler (copied wiring).
- Backend: NO change — `UserRepository.search_by_login_prefix` already
  matches prefixes containing `@`, pinned by
  `backend/tests/integration/chat/test_social_api.py:129` (`alice@ex`).

## Why the strip existed

Legacy Practicum convention: `@` was a search MARKER (`@login`) and
could not be part of a login, so the modal removed it defensively. The
own-backend login IS the full email — the strip now destroys the very
character the query needs. Removing it changes no search semantics: the
server still receives a prefix, just the one the user typed.

## Risks

- Minimal: the strip removal only widens what reaches the search; the
  debounce, empty-input reset, refocus and disabled-result behaviour are
  untouched. The existing messenger debounce test asserts the @-strip —
  it must be UPDATED (not just extended), otherwise verify fails.
- Guard/layers: no new imports; components stay controller-free.

## Execution model

One workstream, sequential, `npm run verify` + guard strict as the
quality floor and evidence; branch rides on top of the contacts feature
branch (or its merged successor on dev).
