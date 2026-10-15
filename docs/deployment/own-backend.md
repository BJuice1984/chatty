# Own backend deployment (canonical runbook)

Local runbook for the owned Chatty backend: FastAPI API, PostgreSQL and the
RustFS S3-compatible object store on a private Docker network, with Ollama as
an external host dependency and the frontend running in Vite `own` mode.
This document supersedes `docs/deployment/internal-backend.md`, which stays
in the repository as a historical stage reference and is not deleted. The
scope is local and internal verification only; nothing here is a production
deployment claim, and no real secrets belong in any file committed to Git.

## Preflight

1. Install Docker Engine with Compose v2, Node `^20.19.0 || >=22.12.0` and
   (for the deterministic backend gate) Python 3.11–3.14.
2. Install native Ollama on the host and pull the models in advance:
   `ollama pull qwen3:14b` (chat provider) and `ollama pull nomic-embed-text`
   (embeddings). There is no cloud fallback — without Ollama the live AI rows
   are recorded as `UNAVAILABLE`, not as failures of this runbook.
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
curl -f http://127.0.0.1:11434/api/tags
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
- Ollama is a host process, not a Compose service. `docker-compose.yml` does
  not wire `CHATTY_RAG_EMBEDDING_URL`/`CHATTY_BOT_PROVIDER_URL` into the API
  container, and the application defaults point at `127.0.0.1:11434`, which
  is container-local. For a live AI smoke, add both variables to the `api`
  service environment with an address the container can reach (for example
  `http://host.docker.internal:11434` on Docker Desktop) and recreate the
  service. Without this step the bot fails explicitly with a provider
  connectivity error — record it as `UNAVAILABLE` rather than reconfiguring
  ad hoc.
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

If Docker, PostgreSQL, RustFS, Ollama or the target internal network is
unavailable, record that dependency as `UNAVAILABLE`; never describe it as a
passing live deployment check. Deterministic gates (`npm run verify`,
`backend/verify.sh`, `docker compose config --quiet`) remain separate
evidence.

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
