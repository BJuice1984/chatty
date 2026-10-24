# Developer overview — 2026-10-19-chat-ui-polish

Frontend-only UI stage. Key files: `src/components/message/*` (bubble),
`src/components/messenger/*` (mapping + back control), `src/features/chats/pages/chat/*`
(mobile switch state), `src/scss/components/{messenger,chat}.scss`,
`src/scss/utils/variable.scss` (breakpoints). Style: 4-space indent, single
quotes, no semicolons, `.ts` imports, Russian comments; stylelint enforced
(`npm run stylelint`); hbs-test-loader precedent for component tests
(`src/features/ai-assistant/hbs-test-loader.ts`). Existing suites must stay
green (186). Live stack for receipts: front on 3001 (vite own mode), smoke
account manual.smoke2@example.com / ManualSmoke-2026, chat
«harden-manual-smoke-2» has messages from both the user and the bot for
side checks; AI chats hold bot answers for theirs-side bubbles. Headless:
playwright-core + /usr/bin/google-chrome-stable; screenshots into the
evidence folder (gitignored) for the operator.
