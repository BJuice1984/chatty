# Implementation plan

1. Freeze the internal topology contract: frontend will be a later client, API/PostgreSQL/MinIO run on the target internal host, and no Ollama/model dependency is part of this package.
2. Define backend settings, dependency injection, health/readiness, security primitives and database session/base with environment-only secrets.
3. Add user model, auth schemas/repository/service/endpoints, cookie JWT refresh rotation, logout, role checks and seed contract.
4. Add Alembic baseline, FastAPI app and a domain-router discovery seam that later stages can extend without editing this package's files.
5. Add Compose, backend Dockerfile, safe `.env.example`, the tracked `docs/deployment/internal-backend.md` runbook, backend verification and root `verify:backend`/`verify:all` scripts.
6. Run deterministic auth/security/health unit tests; run bounded Compose health/auth smoke on the target internal environment and record otherwise `UNAVAILABLE`.
7. The worker must create the listed backend paths, root scripts and tracked deployment document before invoking the post-write validation commands; their absence at draft/freeze time is intentional. Produce one evidence receipt per acceptance criterion and stop after this package write set is complete.
