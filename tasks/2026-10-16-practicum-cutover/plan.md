# Stage 12: live-smoke fixes + practicum cutover

Single workstream **WS-LIVE-CUTOVER** (owner `worker-live-cutover`), two
sequential phases. Phase A adopts the live fixes with regression coverage and
closes HD-R2; phase B (on the accepted phase-A delta) removes every Yandex
Practicum dependency.

## Background

The first live run of the whole own contour (2026-10-15/16, operator-authorized
smoke after PR #24) closed the stage-11 browser checklist (all five HARDEN-*
rows PASS, `harden-reconnect-history.md`) and surfaced findings that could
never appear in deterministic-only runs. Fixes for LIVE-2…LIVE-7, HD-R3 and
the status-hold UX already live in the working tree of
`feature/2026-10-16-practicum-cutover` (base `dev@d72a4ce`); `npm run verify`
is green at 172 tests. The operator then decided (2026-10-16): the project
will never depend on the Yandex Practicum course backend again — every
remaining dependency must go.

## Phase A — adopt live fixes, close HD-R2 (AC-LIVE-1, AC-LIVE-2)

1. **Adopt the live fixes into the reviewed delta** (no silent rewrites):
   review each diff against the finding list, keep semantics as exercised in
   the live run.
   - LIVE-5 (HIGH): `src/utils/Store.ts` — `Store.set` emit guard compares
     content (deep snapshot before/after) instead of references mutated by
     `helpers.merge`; nested slices (`chatHistory`, `aiAssistant`) emit again.
   - LIVE-7: `src/components/messenger/messenger.ts` — `onSendMessage` is
     passed into props; send/delete handlers read `this.props`, not the
     frozen constructor closure.
   - HD-R3: `src/features/chats/history/controller.ts` — 10 s load timeout
     returns the status row to a working state (text error + retry); UX
     success status hold (2 s) after `applyOlderHistory`.
   - LIVE-2: `src/features/auth/pages/login/login.ts` +
     `src/utils/validators.ts` — own-mode email validation (dots allowed in
     the local part), login trim in `AuthController.signin`.
   - LIVE-3: `src/features/chats/pages/chat/chat.ts` — `fetchChats()` in the
     ChatPage constructor (SPA login flow); note: `componentDidMount` never
     fires in this codebase (`dispatchComponentDidMount` has no callers) —
     recorded as core debt, do not fix here.
   - LIVE-4: `chat.hbs` (no literal `src=null`) + null-guard in `ChatAvatar`.
   - LIVE-6: `WSTransport` ping carries `content: {}`; `WSTransportMessage`
     allows object content.
2. **Add the missing regression tests** — one per finding, in these files
   (all in the write-set):
   - `src/utils/Store.test.ts` (new): nested-slice `set` emits on every
     patch, not only the first.
   - `src/utils/validators.test.ts` (new): email local part with dots,
     trim-tolerant validation.
   - `src/components/messenger/messenger.test.ts` (new, hbs-test-loader
     precedent from ai-assistant): send dispatch carries the current
     `selectedChat` (LIVE-7).
   - `src/features/chats/pages/chat/chat.test.ts` (new): the page requests
     chats on construction (LIVE-3).
   - `src/components/avatar/chatAvatar/chatAvatar.test.ts` (new): null/empty
     src renders without calling `fileUrl` (LIVE-4).
   - `history.test.ts` / `WSTransport.test.ts`: already updated (HD-R3
     timeout/hold, ping content) — keep green.
3. **Close HD-R2** (`src/features/chats/ws/own.ts` + `ws.test.ts`):
   - The initial history request lives in ONE place — the transport
     `Connected` subscription (it fires both on first open and on internal
     backoff reconnects); the post-`await connect()` send at the bottom of
     `connect()` is removed, so the first page is never double-requested.
   - Response routing must not misclassify a fresh primary page as a
     pending «загрузить ещё» answer after a reconnect: route by the request —
     `before_id === null` answers go to `applyInitialHistory` (or reset the
     pending-load flag when `Connected` fires) — pick one, cover it in
     `ws.test.ts` with a mocked second `Connected` event and an in-flight
     load, assert no duplicates and no reorder.

## Phase B — practicum cutover (AC-CUT-1, AC-CUT-2, AC-CUT-3)

1. **Delete practicum adapters** (paths stay in the write-set as deletions):
   `src/features/{auth,chats/api,profile,ai-assistant}/api/practicum.ts` and
   `src/features/chats/ws/practicum.ts`; each `api/index.ts` exports the own
   implementation directly (drop the mode fork).
2. **Collapse the env fork** (`src/utils/env.ts`, `env.test.ts`): single own
   mode; remove `resolveMode`, `VITE_APP_MODE` and practicum defaults.
   **Naming decision (fixed):** keep the Vite mode name `own` and the
   `.env.own.example` file — `npx vite --mode own` is Vite configuration
   naming that loads `.env.own`; only the application-level mode fork goes
   away. Update the tracked env files: `.env.development` (currently
   practicum URLs) is REWRITTEN to own defaults so the plain `npm run dev`
   entry point stays valid after cutover; `.env.example` header is rewritten
   for the single own story; `.gitignore` negations follow. (Rewrite, not
   deletion — the grep command in developer-overview lists these files
   explicitly.)
3. **Unify forms on the own contract**: login field is email (label +
   validator, no mode fork); register keeps only email, password and confirm
   (`RegisterRequest = Credentials` in `backend/app/schemas/auth.py`);
   `SignUpRequest` slimmed in `auth/ports.ts`. Calibrate validators to the
   own contract: **password minimum 12** (`validators.ts` + test) — the
   backend rejects shorter passwords anyway.
4. **Clean shared contracts conservatively**:
   - `src/features/chats/ports.ts`: drop practicum-only quirks whose only
     consumer is gone.
   - `src/utils/types.ts`: remove ONLY fields whose only producers were the
     deleted practicum adapters AND that have no consumers left (typecheck
     must stay green). `AuthUser` keeps its shape (the own adapter fills
     placeholders); `loginValidator`/`nameValidator`/`phoneValidator` stay —
     the profile page consumes them.
   - `src/features/chats/history/{merge,types,view}.ts`: clean practicum
     docstrings/comments; with `cursorForBatch` gone, `oldestMessageId` and
     its test are removed (no consumers left).
   - `ws/gateway.ts`: own adapter directly.
5. **Remove course CI**: delete `.github/workflows/tests.yml` (course bats
   autotests, sprint-only; explicit operator decision). `verify.yml` stays.
6. **Docs**: README/AGENTS/CLAUDE rewritten for own-only reality; `docs/arch/
   {README,data-layer,build-and-infra}.md` practicum references cleaned;
   `docs/deployment/internal-backend.md` historical note points at the
   removed course backend as history only.
7. **Grep gate** (scriptable, evidence EV-CUT-1): zero matches for
   `practicum|ya-praktikum|Практикум` across `src/`, `.github/`,
   `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/arch/` and the tracked root
   `.env*` example files. `docs/progress/` and `tasks/` archives are exempt
   as history.

## Verification

- `npm run verify` after phase A and after phase B (all stages green).
- `npm run verify:all` (PYTHON_BIN venv reproduction) + `docker compose
  config --quiet` + `node .claude/hooks/scripts/guard-architecture.mjs --all
  --strict` (0 violations).
- Ownership audit: every changed path owned, 0 forbidden.
- Live re-smoke after cutover on the running stack (chat list after login,
  history load-more, send-message echo): rows recorded in the EV-CUT-2
  artifact; the controller appends them to the stage-11 checklist
  (lead-owned).

## Evidence

- EV-LIVE-1: verify with the full regression set (one test per live finding).
- EV-LIVE-2: HD-R2 reconnect re-request test receipt.
- EV-CUT-1: grep gate (0 practicum matches incl. root env examples) +
  verify:all + compose + guard.
- EV-CUT-2: docs/CI diff review + ownership audit + live re-smoke rows.
