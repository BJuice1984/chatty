# Stage 9 — Durable AI bot (refrozen r3)

Roadmap alias: `backend-bot`; ALK package id: `2026-09-28-backend-bot`.
Branch `feature/2026-09-28-backend-bot` from `dev@e33c6997d73faf687a711105e82c77cabee172bb`
(PR #21 = stage 8 backend-docs-rag; the base carries the whole accepted backend
contour and the stage 2–4/7 frontend contour through PRs #16–#21).

The stage owns a provider-independent durable bot run: a member asks the bot to
answer an existing chat message; the run persists its state machine, consumes
the stage 8 chat-scoped search, calls a local provider behind a bounded seam
and posts the answer as an authorized chat message with an optional `file_id`
attachment. The provider defaults to local Ollama (`qwen3:14b` per the master
plan, configurable); no cloud fallback exists at any layer.

## Verified base-tree facts (read at refreeze, dev@e33c699)

- `Chat.is_ai` exists (stage 6, `backend/app/models/chat.py:19`); `User` has
  `role` but **no `is_bot` column** — the bot must be a normal user.
- `Message.user_id` is `nullable=False` (`backend/app/models/message.py:22`) —
  a bot answer is a message authored by the bot **user**.
- `MessageService.create` (`backend/app/services/messages.py:26`) enforces
  membership and file authorization (`file.chat_id == chat_id` +
  `status == 'ready'`); the consumed `MessageCreate` schema caps content at
  20 000 chars and requires content-or-file.
- `ChatService.require_member` / `add_member` (`backend/app/services/chats.py`)
  authorize the requester and join members with a member as requester.
- `DocumentService.search` (`backend/app/services/documents.py:98`) is
  membership-scoped, considers only `ready` documents, returns
  `(DocChunk, score)` with `chunk.file_id`, and raises an explicit 503 when the
  embedding provider is unavailable.
- Composition seam: `register_domain_router` (stage 5) with the stage 8
  mounting precedent in `backend/app/api/v1/endpoints/__init__.py`
  (`documents.register_domain()` at package init, local import + cold-import
  guard in the endpoint module).
- `httpx` is already a runtime dependency (stage 8) — the provider needs **no
  new dependencies**; `backend/pyproject.toml` stays untouched.
- Test seams: `tests/conftest.py` provides `client`/`app`/`session_factory`
  (sqlite in-memory); stage 8 injected fakes through `app.state.object_storage`
  and `app.state.embedding_provider` without touching conftest.

## Design decisions

- **Trigger** — `POST /api/v1/chats/{chat_id}/bot/runs` with `{"message_id": N}`
  (auth: current user; `require_member`). Synchronous bounded execution in
  `asyncio.to_thread`, exactly like the stage 8 endpoints. The WS-hub
  auto-trigger and live broadcast of bot answers are an **explicit AI-UI
  carry-forward**; this stage delivers the durable REST contract.
- **Source-message validation** (before any external call) — the message must
  exist (404 `message_not_found`), belong to the route chat
  (400 `message_not_in_chat`, mirroring the history-cursor check in
  `MessageService.history`), carry text content
  (400 `message_content_required` for file-only sources — the RAG query needs
  text) and must not be authored by the bot user itself
  (409 `bot_own_message`). A member of chat A therefore cannot pass chat B's
  `message_id` and pull foreign content into chat A's answer.
- **Durability/idempotency** — `bot_runs` table with `unique(message_id)`:
  one run per source message ever. The row is inserted as `queued`; claiming
  execution is a **conditional compare-and-set** transition
  (`queued` → `running`, committed before any external call — the stage 8 RV3
  lesson). A concurrent first delivery loses the insert race on the unique key
  and re-reads the existing row (the `MessageService.create`
  `client_message_id` IntegrityError pattern). Duplicate delivery against a
  fresh, `running` or `succeeded` row returns that row **without
  re-execution** — at most one active execution per message.
- **Stale-run recovery** — a hard crash can leave a `queued`/`running` row
  with no live execution. A new delivery may **re-claim** such a row only
  after a staleness window: `updated_at` older than
  `CHATTY_BOT_STALE_AFTER_SECONDS` (default 180 — well above the provider
  timeout). The claim is again a conditional update
  (`status IN ('queued','running') AND updated_at < cutoff`), increments
  `attempt` (the crashed claim consumed budget) and is serialized against
  other claims by the same CAS. The service takes an **injectable clock** so
  the window is tested deterministically without sleeps.
- **Bounded retries** — `attempt` counts execution claims, capped by
  `CHATTY_BOT_MAX_ATTEMPTS` (default 2); an explicit retry of a `failed` row
  within budget re-claims with `attempt++`; exhausted budget is an explicit
  409 `retry_budget_exhausted`, never a silent loop. Provider
  transport/HTTP/malformed-payload failures are explicit typed errors (the
  stage 8 RV1 regression class is covered from day one by tests).
- **Bot identity** — resolved by configured email (`CHATTY_BOT_USER_EMAIL`,
  default `bot@chatty.local`) via `UserRepository.get_by_email`. The account
  is a normal one **created through the public auth API by the operator**
  (`POST /api/v1/auth/register` with the configured email); no seeding code is
  added (`backend/app/seed.py` is outside the write-set). Until the account
  exists, runs fail explicitly with `bot_user_not_configured` — the accepted
  steady state, recorded in the EV-BOT-2 checklist instructions. The bot joins
  only `is_ai` chats (non-AI chat → explicit 409
  `bot_not_enabled_for_chat`), and the join goes through
  `ChatService.add_member` with the requesting member as requester — no
  repository bypass, no user-model change.
- **Data scope** — the search tool is `DocumentService.search` behind an
  injectable seam (`rag_search` callable), called with the **source chat** and
  the bot user; chat-scoped ready-only chunks feed a prompt context block.
  The prompt is built only from the system template, that chat-scoped context
  and the source message content. The top hit's `file_id` becomes the optional
  attachment, posted through `MessageService.create`, whose authorization
  (chat-owned, ready file) is the enforcement point and is never bypassed.
- **Provider** — `BotProvider` protocol + `OllamaBotProvider` (httpx
  `POST {url}/api/chat`, `stream: false`, injectable transport for
  MockTransport tests; `app.state.bot_provider` injection seam preferred).
  No langchain, no cloud fallback, zero dependency changes.
- **Settings** — `backend/app/bot/config.py` reads `CHATTY_BOT_*` env settings
  with safe defaults (provider url/model, timeout seconds, max attempts, stale
  window, bot user email, rag top-k, answer char cap); `backend/app/core/config.py`
  and `backend/.env` contracts of predecessors stay untouched. The
  operator-facing defaults are appended to `backend/.env.example`.
- **Migration** — handwritten `004_bot_runs` mirroring the model 1:1
  (columns, indexes, unique constraint), `down_revision = 003_documents_chunks`.
  FK rules are pinned: `message_id` → messages **ON DELETE CASCADE** (a run
  dies with its source message; both already live under the chat's own
  CASCADE), `bot_user_id` → users **RESTRICT**, `response_message_id` and
  `attachment_file_id` **ON DELETE SET NULL**. The migration is not exercised
  by the deterministic gate (tests build tables from metadata;
  `verify.sh` checks `alembic heads`), so this text is the pin.

## Honest environment gates

- `BOT-OLLAMA` stays `UNAVAILABLE` unless a native Ollama with the configured
  model actually answers; it is never converted to a synthetic PASS. All
  provider behavior is covered deterministically by fake providers and
  `httpx.MockTransport`.
- The deterministic test gate runs in the isolated container on sqlite
  (stage 5–8 receipt pattern); no live PostgreSQL/RustFS is required.
- Live pgvector storage, WS-hub triggering and answer broadcast remain
  carry-forwards (hardening / AI-UI stages).

## Refreeze deltas r2 → r3 (round-1 audit findings)

- **[MEDIUM] Source-message validation specified** — existence
  (`message_not_found`), chat ownership (`message_not_in_chat`, the
  cross-chat disclosure hole), text-content requirement
  (`message_content_required` for file-only sources) and the bot-own-message
  guard (`bot_own_message`); a cross-chat integration test added to the plan.
- **[MEDIUM] Duplicate-delivery vs crash-resume disambiguated** — execution
  claim is a conditional queued→running CAS; duplicates on fresh/running/
  succeeded rows never re-execute; stale `queued`/`running` rows older than
  `CHATTY_BOT_STALE_AFTER_SECONDS` are re-claimable with `attempt++` under the
  same CAS; injectable clock keeps the window deterministically testable;
  exhausted budget is an explicit 409.
- **[LOW] Bot-user bootstrap pinned** — operator registers the account via
  the public auth API; `bot_user_not_configured` is the accepted steady state
  until then (no seed edits; EV-BOT-2 records it).
- **[LOW] `bot_runs` FK on-delete rules pinned** — message_id CASCADE,
  bot_user_id RESTRICT, response_message_id/attachment_file_id SET NULL
  (the deterministic gate never runs the migration, so the plan text is the
  contract).
- **[LOW] forbiddenWrites made explicit** for the consumed
  `backend/app/schemas/message.py`, `backend/tests/conftest.py`,
  `backend/alembic/env.py` and `backend/verify.sh` (stage 8 precedent:
  consumed schema file was forbidden there).
- Wording: the 20 000-char content cap is attributed to the consumed
  `MessageCreate` schema, not the service.

## Refreeze deltas r1 → r2

- Baseline moved from the stale `main@d79de677` to the accepted
  `dev@e33c699` (launchGate and `compatibility.baseBackend` updated).
- Write-set reconciled with the real tree (the r1 holes that stage 8's audit
  already taught us to look for): **`backend/app/api/v1/endpoints/__init__.py`**
  added (the mounting point of the composition seam),
  **`backend/app/repositories/bot_runs.py`** added (repository-layer idiom),
  **`backend/.env.example`** added (new `CHATTY_BOT_*` operator vars).
  `backend/pyproject.toml` is *not* written — no new dependencies — and is
  pinned in `forbiddenWrites` to make that explicit.
- `artifactPaths` converted from the r1 array (a known ALK 2.15 compile
  blocker, stage 2 r4 precedent) to the per-attempt
  `{"result", "review"}` dict.
- `validation.commands[1]` rewritten into the reproducible stage 5–8 form
  `(cd backend && PYTHONPATH=. python3 -m pytest tests/unit/bot tests/integration/bot)`.
- `leadOwned` fixed for the frozen plan package and the progress log;
  `readOnly`/`forbiddenWrites` enumerate the consumed predecessor contracts
  (chat/user/message/file/document models, chat/message/document services,
  WS hub, ingestion, central composition, core config).
- langchain dropped from capabilityHints/compatibility (plain httpx provider
  protocol; the master plan's LangChain agent shape degrades to the same
  provider+tool seams without the dependency).
- Trigger contract made explicit (REST run per source message; WS-hub hook =
  AI-UI carry-forward); bot identity by configured email documented against
  the verified absence of `User.is_bot`.
