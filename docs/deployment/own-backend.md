# Own backend deployment (canonical runbook)

Local runbook for the owned Chatty backend: FastAPI API, PostgreSQL and the
RustFS S3-compatible object store on a private Docker network, with a local
AI inference server as an external host dependency and the frontend running
in Vite `own` mode. The AI seams speak two protocols, selected by
`CHATTY_BOT_PROVIDER_API`/`CHATTY_RAG_EMBEDDING_API`: `ollama` (default,
native `/api/chat` and `/api/embed`) or `openai` (OpenAI-compatible
`/v1/chat/completions` and `/v1/embeddings`, e.g. a llama.cpp server).
This document supersedes `docs/deployment/internal-backend.md`, which stays
in the repository as a historical stage reference and is not deleted. The
scope is local and internal verification only; nothing here is a production
deployment claim, and no real secrets belong in any file committed to Git.

## Preflight

1. Install Docker Engine with Compose v2, Node `^20.19.0 || >=22.12.0` and
   (for the deterministic backend gate) Python 3.11–3.14.
2. Prepare the AI inference server for the configured provider mode (there is
   no cloud fallback — without a reachable server the live AI rows are
   recorded as `UNAVAILABLE`, not as failures of this runbook):
   - `ollama` mode (default): install native Ollama on the host and pull the
     models in advance: `ollama pull qwen3:14b` (chat provider) and
     `ollama pull nomic-embed-text` (embeddings).
   - `openai` mode: point `CHATTY_BOT_PROVIDER_URL` (and, if the server has
     an embeddings endpoint, `CHATTY_RAG_EMBEDDING_URL`) at the
     OpenAI-compatible server and take the model ids from its
     `/v1/models` response (for llama.cpp the id is the full gguf path).
     No model pulls happen through the app in this mode; the server must
     already serve the models.
3. Copy `backend/.env.example` to an operator-managed environment file, set
   random values for `POSTGRES_PASSWORD`, `CHATTY_JWT_SECRET` and the
   `OBJECT_STORAGE_ACCESS_KEY`/`OBJECT_STORAGE_SECRET_KEY` RustFS credentials.
   Keep the populated file outside Git and limited to the operator.
4. Check the Compose file against that environment (syntax gate, no output on
   success):

   ```bash
   docker compose --env-file <operator-env> config --quiet
   ```

5. Prepare the frontend environment: copy `.env.own.example` to `.env.own`
   (local API/WS/files URLs on `localhost:8000`).
6. Record the Git revision being deployed and the plan digest alongside the
   deployment receipt before starting, and confirm a database backup location
   for rollback.

## Start and verify

From the repository root, with the operator environment loaded:

```bash
docker compose --env-file <operator-env> up -d --build
curl -f http://127.0.0.1:8000/health
curl -f http://127.0.0.1:8000/ready
curl -f http://127.0.0.1:9000/health
backend/verify.sh
# AI server check, mode-dependent:
curl -f http://127.0.0.1:11434/api/tags          # ollama mode (host-local tags)
curl -f http://<provider-url>/v1/models          # openai mode (model ids for CHATTY_BOT_MODEL)
```

Notes on what these checks mean:

- The API container runs `alembic upgrade head`, the optional admin seed and
  then Uvicorn; `health`/`ready` answer only when migrations and wiring are
  up. The `object-storage-volume-init` helper grants the RustFS non-root UID
  access to the named data volume before the store starts.
- `backend/verify.sh` is the deterministic backend gate (pytest, alembic
  heads). From the frontend package it is also available as
  `npm run verify:backend`; `npm run verify:all` runs frontend and backend
  gates together.
- The AI server is a host/LAN process, not a Compose service.
  `docker-compose.yml` passes `CHATTY_BOT_*`/`CHATTY_RAG_*` (protocol knobs,
  URLs, models, limits) through to the `api` container environment, but the
  committed defaults point at `127.0.0.1:11434`, which is container-local:
  `127.0.0.1` inside the container is the container itself. For a live AI
  smoke, set `CHATTY_BOT_PROVIDER_URL` (and the RAG equivalents) in the
  operator env file to an address the container can reach — for example
  `http://host.docker.internal:11434` for Ollama on Docker Desktop or the
  LAN address of the OpenAI-compatible server — switch
  `CHATTY_BOT_PROVIDER_API`/`CHATTY_RAG_EMBEDDING_API` to `openai` where
  needed, and recreate the api service. Without this step the bot fails
  explicitly with a provider connectivity error — record it as `UNAVAILABLE`
  rather than reconfiguring ad hoc.

### Operator inference host (LAN Mac mini, llama.cpp)

The operator's inference host is a Mac mini on the LAN (`192.168.1.121`)
running three llama.cpp servers, all OpenAI-compatible (`/v1/models`,
`/v1/chat/completions`). The operator has PHYSICAL access to the host, so
restarting servers with different flags is possible on-site (no remote
access is configured). Layout as probed live on 2026-10-27 — ports 8080 and
8081 are easy to confuse, verify with `/v1/models` before wiring anything:

| Port | Model (gguf id) | Role |
| --- | --- | --- |
| `8082` | `Qwen3.5-9B-Q4_K_M` | the chat model — point `CHATTY_BOT_PROVIDER_URL` here; a thinking model (long `reasoning_content`), keep `CHATTY_BOT_TIMEOUT_SECONDS` generous (300) |
| `8083` | `bge-m3-q8_0` | dedicated RAG embeddings (dim 1024, `--embeddings --pooling cls`, since 2026-10-27) — point `CHATTY_RAG_EMBEDDING_URL` here |
| `8080` | `Qwen3-VL-4B-Instruct-Q4_K_M` | multimodal (VL); NOT a chat-model substitute for the bot |
| `8081` | `Hy-MT2-1.8B-Q4_K_M` | weak translation model; not for the bot |

Embeddings: RAG runs on the dedicated `bge-m3` instance `:8083` (`--embeddings --pooling cls`,
dim 1024) since 2026-10-27; the chat instance `:8082` also serves `/v1/embeddings`
(`--pooling mean`, dim 4096) as a stopgap, but vectors from different models/poolings are
incompatible — never mix them in one corpus (a model change requires a full re-ingest).

Known llama.cpp quirks found during the 2026-10-27 acceptance: the Qwen3.5 chat template
answers 500 to two consecutive `system` messages (the bot prompt merges context into a
single system block, `app/bot/prompts.py`); with a single busy slot the server may answer
503 immediately.

Historical note: before 2026-10-27 the chat model lived on `:8080` —
operator env files older than that date point `CHATTY_BOT_PROVIDER_URL` at
`:8080`, which now serves the VL model; move the bot to `:8082`.
- Embeddings 501 policy: an OpenAI-compatible server without an embeddings
  endpoint typically answers `/v1/embeddings` with HTTP 501. The embedding
  seam turns that into an explicit failure (`embedding_provider_failed`
  during ingestion, HTTP 503 during retrieval) — RAG document rows stay
  honestly `UNAVAILABLE`; they are never silently skipped or faked.
- Frontend: `npm ci`, then `npx vite --mode own` for the dev server, or
  `npm run build && npm start` for the production bundle served from `dist/`
  on port 3000. `npm run verify` must pass before any deploy artifact is
  recorded.

First auth smoke (through the frontend origin from `CHATTY_ALLOWED_ORIGINS`):
register or log in via `/api/v1/auth`, retain the HttpOnly access/refresh
cookies, send the `chatty_csrf` value in `X-CSRF-Token` for refresh/logout,
and confirm that logout removes access to `/api/v1/auth/me`. The live AI
scenario then walks: create an `is_ai` chat, upload a document, ask the
assistant and download the attached file.

If Docker, PostgreSQL, RustFS, the AI inference server or the target
internal network is unavailable, record that dependency as `UNAVAILABLE`;
never describe it as a passing live deployment check. Deterministic gates
(`npm run verify`, `backend/verify.sh`, `docker compose config --quiet`)
remain separate evidence.

## Rollback

1. Stop the stack without deleting named volumes:

   ```bash
   docker compose --env-file <operator-env> down
   ```

2. Restore the previously approved Git revision recorded in the receipt
   (`git checkout <revision>`), rebuild and start the stack again
   (`up -d --build`).
3. If migrations had moved forward, restore the database from the
   pre-deploy backup before restarting the API. Do not delete the
   `chatty-postgres`/`chatty-object-storage` volumes without a verified
   backup.
4. Rerun the health/readiness curls and the auth smoke; only then record the
   rollback as complete.

## Demo story feed seed (`CHATTY_SEED_DEMO_STORIES`)

The api container startup runs `python -m app.seed` after migrations. Besides
the optional admin seed (`CHATTY_SEED_ADMIN_EMAIL`/`CHATTY_SEED_ADMIN_PASSWORD`)
it can seed a demo story feed: three users (`midala@chatty.demo`,
`athalia@chatty.demo`, `erlan@chatty.demo`) each with a real story — the photo
is uploaded to RustFS and the `files`/`stories` rows are created exactly as a
live upload would, so the frontend feed is indistinguishable from real users'
stories.

The demo seed is **opt-in via the operator env only** (default off, so clean
stacks stay free of demo users):

```bash
# operator env file (gitignored)
CHATTY_SEED_DEMO_STORIES=true
```

Behaviour details:

- idempotent: repeated restarts neither duplicate users/files/stories nor
  re-upload objects;
- TTL support: a demo story whose `created_at` is within an hour of falling
  out of the 24h feed TTL is refreshed on the next startup — demo tiles never
  silently disappear, but they do not jump above freshly uploaded personal
  stories on every restart either;
- turning the flag off does not delete anything already seeded; it only stops
  maintaining the demo feed (the stories age out of the feed by TTL naturally);
- demo users get a fixed technical password (`DemoStoriesDoNotLogin2026!`)
  and are not meant for signing in.
