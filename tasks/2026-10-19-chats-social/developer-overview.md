# Developer overview — 2026-10-19-chats-social

Phase A is backend-only (FastAPI + alembic + pytest, httpx offline tests,
`npm run verify:backend`). Phase B is frontend-only and starts after A is
accepted: ports/adapters → controller → components → scss → tests. Style:
Python — single quotes, trailing commas, explicit error kinds; TS — 4-space,
single quotes, no semicolons, `.ts` imports, Russian comments; stylelint
enforced. Existing suites: 203 frontend / 152 backend — keep green. Fixed
emoji set: 👍 ❤️ 😂 😮 😢 🙏. Login handle in the own contract is the email.
Live stack for phase-B receipts: front 3001, api 8000, accounts
manual.smoke2@example.com / ManualSmoke-2026 and ui.smoke.peer@example.com
(ask the controller for credentials); screenshots into the evidence folder.
The stage-15 adaptive base (bubbles, breakpoints 768/1024, chatPaneOpen
switch) is the styling foundation — reuse it, do not re-invent.
