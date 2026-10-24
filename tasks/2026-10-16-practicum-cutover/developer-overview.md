# Developer overview — 2026-10-16-practicum-cutover

## Where you start

Branch `feature/2026-10-16-practicum-cutover` from `dev@d72a4ce`. The working
tree already contains the live-smoke fixes (see `git status`: Store.ts,
WSTransport.ts(+test), validators.ts, messenger.ts, chatAvatar.ts, chat.hbs,
chat.ts, login.ts, auth/controller.ts, history/controller.ts(+test)) — they
were applied and exercised live against the running compose stack; `npm run
verify` is green (172 tests). Do not rewrite their semantics; your job in
WS-LIVE-CUTOVER (phase A) is to review them and add the missing regression tests, then
close HD-R2. WS-LIVE-CUTOVER (phase B) then removes the practicum fork entirely.

## Key files by area

- Core store: `src/utils/Store.ts` (emit guard — content comparison),
  `src/helpers/helpers.ts` (mutating merge — read-only awareness).
- Transport: `src/utils/WSTransport.ts` (bounded reconnect/backoff, ping with
  `content: {}`, close cleanup), tests in `WSTransport.test.ts`.
- History: `src/features/chats/history/` (controller timeouts/hold, slice,
  merge, self-registering `view.ts`).
- WS adapters: `src/features/chats/ws/{gateway,own,practicum}.ts` — after
  cutover only `own`; HD-R2 lives in `own.ts` (Connected re-request).
- HTTP adapters: `src/features/*/api/{index,own,practicum}.ts` — the mode
  fork in each `index.ts` collapses to own.
- Env: `src/utils/env.ts` (single own mode, `VITE_APP_MODE` removed). The Vite mode name `own` and `.env.own.example` STAY (Vite config naming, loads `.env.own`); the tracked `.env.development` practicum URLs are rewritten to own defaults and `.env.example` follows the single-example story.
- Forms: `src/features/auth/pages/{login,register}/` — own contract only.
- CI: `.github/workflows/tests.yml` (course bats) is deleted;
  `verify.yml` untouched.
- Docs: `README.md`, `AGENTS.md`, `CLAUDE.md` (imports AGENTS),
  `docs/arch/{README,data-layer,build-and-infra}.md`.

## Conventions that apply

- Style: 4-space indent, single quotes, no semicolons, trailing commas;
  imports with `.ts`; run `npm run eslint:fix` before committing.
- Layers: pages → components → controllers → api → utils → core/helpers;
  components never import features (guard blocker) — the history helper
  stays self-registering and loaded from ws adapters.
- Tests live next to sources (`*.test.ts`), mocha + chai + sinon + jsdom;
  one regression test per finding is the quality floor.
- Evidence receipts go to `work/2026-10-16-practicum-cutover/evidence/…`
  (gitignored); the plan package in `tasks/` is committed.
- Commit messages: conventional, no Co-Authored-By, no attribution lines.

## Verification commands

```bash
npm run verify                       # typecheck + mocha + eslint + stylelint
PYTHON_BIN=<venv-python> npm run verify:all
docker compose --env-file <operator-env> config --quiet
node .claude/hooks/scripts/guard-architecture.mjs --all --strict
grep -ri 'practicum\|ya-praktikum\|Практикум' src .github README.md AGENTS.md CLAUDE.md docs/arch .env.development .env.example .env.own.example   # must be empty
```

## Known live-stack facts (if you re-smoke)

Operator env: `~/.config/chatty/own-backend.env` (600, never committed);
stack `docker compose --env-file … up -d`; front `npx vite --mode own --port
3001` (3000 busy); Ollama absent → AI rows stay UNAVAILABLE; smoke account
`manual.smoke2@example.com` / `ManualSmoke-2026`, chat «harden-manual-smoke-2»
(60 messages). Headless carrier: playwright-core with
`/usr/bin/google-chrome-stable`.
