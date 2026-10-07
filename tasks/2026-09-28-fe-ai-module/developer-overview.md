# Stage 10 — AI assistant frontend module (refrozen r3)

Roadmap alias: `fe-ai-module`; ALK package id: `2026-09-28-fe-ai-module`.
Branch `feature/2026-09-28-fe-ai-module` from
`dev@9b19dea25cfbd63cc4a58ffc3172ff7a91c2cd87` (PR #22 = stage 9 backend-bot;
the base carries the whole accepted backend contour and the stage 2–4/7
frontend contour through PRs #17–#22).

The stage owns the first feature module of the AI contour: an assistant page
(`/assistant`) where a member of an `is_ai` chat searches the chat's documents
and asks the bot. Consumption is strictly through the feature's own ports
against the accepted stage 8/9 REST contracts; the shared message component,
WS gateway, kernel, utils and other features stay untouched. No bot-supplied
content may become executable DOM.

## Verified base-tree facts (read at refreeze, dev@9b19dea)

- Composition: `src/features/index.ts` exports
  `featureModules: AppModule[]` — the only place cross-feature imports are
  legal (guard-architecture: features rank 6, `features/a → features/b`
  runtime import = blocker, main.ts not checked). `src/main.ts` calls
  `createApp(featureModules)` and registers routes through
  `Router.use(...)`; both files were forbidden in r1 while being the only
  reachable mounting points — the r1 write-set could not deliver a reachable
  feature (the same class of hole the stage 8/9 audits caught).
- Module seam: `AppModule { name, setup }` (`src/core/module/types.ts`),
  `createApp` bootstraps in dependency order (`src/core/app.ts`); the auth
  module is the minimal precedent (`features/auth/module.ts`).
- Adapter idiom (stage 7): `features/<name>/api/index.ts` selects by
  `env.mode`; `own.ts` does real HTTP through `HTTPTransport`;
  `practicum.ts` carries explicit unsupported behavior.
- Environment (stage 1): `utils/env.ts` exposes `env.mode/apiUrl/filesUrl`,
  `joinUrl` (rejects foreign schemes, credentials, traversal) and
  `fileUrl(path)`; URLs are pre-computed and passed as props (the shared
  `Message` component takes a computed `fileUrl` prop — never a raw string
  from the wire).
- Store idiom (stage 4): typed slices over the global store;
  `withStore`-connected pages re-render on `StoreEvents.Updated`.
- Consumed contracts: the chats own adapter *declares* `is_ai` in its
  response DTO but drops it in `toChatInfo()` and the shared `ChatInfo`
  carries no `is_ai` — the AI feature therefore lists chats through **its
  own port DTOs** and never consumes the chats slice for this flag; stage 8
  search returns chat-scoped `DocumentChunkResponse` rows; stage 9 bot runs
  are synchronous-bounded REST (`BotRunResponse` with
  `response_message_id`/`attachment_file_id`, explicit `error_kind`);
  history is `GET /chats/{id}/messages` (newest-first, the run is
  synchronous so the answer lands on the first page).
- Test stack: mocha + chai + sinon + jsdom; feature tests are colocated
  (`features/chats/chats.test.ts`, `features/auth/api/api.test.ts`
  precedents) — r1 had **no test paths** in the write-set although its own
  plan step 4 requires rendering tests.

## Design decisions

- **Scope** — one feature directory `src/features/ai-assistant/`:
  `module.ts` (the `AppModule` unit appended to `featureModules`),
  `ports.ts` (own-mode DTOs + `AiAssistantPort`: list own chats, search
  documents, ask the bot), `api/{index,own,practicum}.ts` (stage-7 idiom;
  practicum = explicit unsupported error — AI endpoints exist only in own
  mode), `store.ts` (typed `aiAssistant` slice:
  `idle/searching/typing/success/empty/error` + query/documents/answer/
  attachment/error; `Store.ts` is write-forbidden with a closed
  `AppState`, so slice reads/writes use the same cast idiom as
  `chatsSlice` and `withStore` selectors declare only their own key),
  `controller.ts` (singleton; state transitions; ask =
  post message → bot run → fetch answer by `response_message_id`),
  `safety.ts` (the only place document URLs are born: integer `file_id` +
  configured apiUrl through `joinUrl` → `files/{id}/download`),
  components `typing-indicator` and `document-card` (+ `.hbs`),
  `pages/assistant` (+ `.hbs`, `withStore`-connected, chat selector over
  own `is_ai` chats) which imports `../styles/ai-assistant.scss`
  (typechecks via the existing `vite/client` `*.scss` declaration in
  `src/vite-env.d.ts`; the centralized `src/scss` entry stays untouched),
  and colocated `*.test.ts` files.
- **Composition** — strictly additive, per the stage-4 precedent that moved
  composition ownership to the migrating stage: `features/index.ts` appends
  `aiAssistantModule` to `featureModules`; `main.ts` appends the
  `/assistant` route and the `Routes.Assistant` entry. Nothing else in
  those files changes.
- **Render safety** — the invariant is scoped to **wire data**: no
  bot-, chat- or backend-supplied value is ever rendered through
  triple-stache. Triple-stache stays reserved for registered
  component-helper calls — the repository's only child-embedding
  mechanism (`registerComponent` helpers emit the wrapping raw HTML, so a
  helper under double-stache would render as visible text; every existing
  page nests components this way) — while every data interpolation inside
  feature templates uses double-stache text escaping. Bot answer and
  chunk content render as text; document links come only from `safety.ts`,
  which rejects non-integer ids and non-configured bases before `joinUrl`
  — `javascript:`, `data:` and foreign origins are structurally impossible
  and covered by a rejection-matrix test plus a template assertion that no
  template interpolates wire data through triple-stache.
- **States** — searching (document search in flight), typing (bot run in
  flight; the stage 9 run is synchronous and bounded, so the indicator is
  request-scoped and bounded), success (answer text + document cards),
  empty (no chunks and no answer content), error (text-only error state
  incl. explicit bot `error_kind` mapping and the practicum unsupported
  mode).
- **Honest environment gates** — the deterministic gate is `npm run verify`
  with fake ports and jsdom; the browser checklist (AI-SEARCHING…AI-FILE)
  runs against a live owned backend and is `UNAVAILABLE` without one;
  live Ollama remains stage 9's recorded UNAVAILABLE and is never converted
  to PASS.

## Refreeze deltas r2 → r3 (round-1 audit findings)

- **[HIGH] Rendering invariant rescoped to wire data** — the absolute
  triple-stache ban contradicted the repository's only component-nesting
  mechanism (registerComponent helpers return raw HTML; every existing
  page nests components via triple-stache). The invariant is now: no
  bot-/chat-/backend-supplied value is ever rendered through triple-stache;
  triple-stache is permitted only for component-helper calls; all data
  inside feature templates is double-stache. The deterministic template
  assertion checks exactly this rule.
- **[MEDIUM] Stylesheet load path declared** —
  `styles/ai-assistant.scss` is imported from feature-local TS
  (`pages/assistant.ts`), typechecked through the existing `vite/client`
  `*.scss` declaration; the centralized `src/scss` entry and
  `components/_all.scss` stay untouched (`compatibility.styles`).
- **[LOW] `is_ai` base-tree fact corrected** — the chats own adapter
  drops `is_ai` in `toChatInfo()`; the feature lists chats through its
  own port DTOs and never consumes the chats slice for the flag.
- **[LOW] `module.ts` named** in the file enumeration (the composition
  imports `aiAssistantModule` from it).
- **[LOW] Store typing pinned** — closed `AppState` and write-forbidden
  `Store.ts`: slice reads/writes use the `chatsSlice` cast idiom and
  `withStore` selectors declare only their own key (`compatibility.store`).
- **[LOW] Checklist recordability** — browser portions of AI-HTML/AI-URL
  may record UNAVAILABLE honestly when the live owned backend is absent,
  with the deterministic escaping/rejection suite carrying the verdict;
  revision/plan-digest/browser/route/input metadata lives in the
  `EV-AI-UI-2.json` receipt.

## Refreeze deltas r1 → r2

- Baseline moved from the stale `main@d79de677` to the accepted
  `dev@9b19dea` (launchGate and `compatibility.baseFrontend`).
- **Composition hole fixed**: `src/features/index.ts` and `src/main.ts`
  moved from forbiddenWrites into the write-set with strictly-additive
  edit contracts (stage-4 ownership-move precedent); the kernel (`src/core`),
  `src/utils`, `src/components`, `src/pages` and the auth/chats/profile
  features are now directory-level forbidden instead of file-level.
- **Test hole fixed**: the feature directory write covers colocated
  `*.test.ts` files that r1's file list made impossible.
- `artifactPaths` converted from the r1 array (known compile blocker) to
  the per-attempt `{"result", "review"}` dict.
- Adapter directory added (`api/{index,own,practicum}.ts`) mirroring the
  stage-7 idiom with an explicit practicum-unsupported seam; r1's bare
  `ports.ts` could not reach the backend without a cross-feature import
  (guard blocker).
- `safety.ts` added as the single URL birthplace; `package.json` and
  `package-lock.json` write-forbidden (zero new dependencies).
- `leadOwned` fixed for the frozen plan package and the progress log.
