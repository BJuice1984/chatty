# Plan — 2026-11-01-email-search

User search accepts the full email. Today both add-user modals
(messenger «Добавить пользователя» and the contacts «Добавить») strip
every `@` out of the input before the debounced prefix search, so
typing `alice@chatty.local` degenerates to the prefix
`alicechatty.local` and finds nothing; only bare prefixes (`alice`)
work. The backend needs NO change: `UserRepository.search_by_login_prefix`
escapes `%`/`_`/`\` and leaves `@` untouched, and
`backend/tests/integration/chat/test_social_api.py:129` already pins
`login=alice@ex` matching — the search is broken purely by the frontend
`@`-strip (a leftover of the legacy `@login` marker convention from the
Practicum era, where `@` could not be part of a login; the own-backend
login IS the full email).

## The change (one workstream, frontend-only)

1. `src/components/messenger/messenger.ts` — delete the `@`-strip block
   in the `input` handler (`raw.includes('@')` → `split/join` → rewrite
   `input.value`); the raw value goes to the debounced search as typed.
   Update the hint in `renderAddUserModalContent`: «Начните вводить
   начало email — поиск сработает сам; «@» не нужен» → «Начните вводить
   начало или полный email — поиск сработает сам». Update the stale
   comment about the `@` marker.
2. `src/components/messenger/messenger.test.ts` — replace the @-strip
   expectation: a query containing `@` is passed to `onSearchUsers`
   unchanged (`alice@chatty.local` survives verbatim; the input value is
   not rewritten).
3. `src/features/contacts/pages/contacts/contacts.ts` — delete the
   mirrored `@`-strip block in the page's `input` handler; update the
   copied comment.
4. `src/features/contacts/pages/contacts/contacts.test.ts` — pin the
   same: `@` survives into `searchUsers` verbatim.
5. `docs/progress/progress_log.md` — entry on top.

Search semantics stay PREFIX (LIKE `prefix%`, server-ordered, cap 10);
only the destroyed characters change.

## Out of scope

Substring/contains search; ranking/fuzzy; backend repository or
endpoint changes (already correct and pinned); the chat-list search
(`GET /chats/search` — different endpoint); validation of the typed
email format.

## Evidence

`npm run verify` (typecheck → mocha → eslint → stylelint) +
`node .claude/hooks/scripts/guard-architecture.mjs --all --strict`.
Live smoke (operator NOTE, not a gate): in either modal, typing
`alice@chatty.local` finds the user; typing `alice` still does.
