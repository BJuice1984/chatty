# Stage 5 — Owned backend skeleton

Roadmap alias: `backend-skeleton`; ALK package id: `2026-09-28-backend-skeleton`. Create `feature/2026-09-28-backend-skeleton` from accepted `main`; this plan was authored on `feature/agent-harness`.

Build the reproducible FastAPI foundation: typed settings, SQLAlchemy/Alembic/PostgreSQL with pgvector-ready base, cookie JWT auth with refresh rotation/logout, roles, CSRF/origin controls, upload limits, seed data, Docker Compose services and deterministic backend verification. The root package scripts are owned here so later stages consume one `verify:backend`/`verify:all` contract.

The app/router composition created here is a stable discovery seam for later domain routers; this stage does not implement chats, documents or bot behavior. Docker/Ollama/Practicum live checks are external gates and must be reported as `UNAVAILABLE` if absent. Never commit credentials.
