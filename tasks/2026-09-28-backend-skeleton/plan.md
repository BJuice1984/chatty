# Implementation plan

1. Define backend settings, dependency injection, security primitives and database session/base with environment-only secrets.
2. Add user model, auth schemas/repository/service/endpoints, cookie JWT refresh rotation, logout, role checks and seed contract.
3. Add Alembic baseline, FastAPI app and a domain-router discovery seam that later stages can extend without editing this package's files.
4. Add Compose, backend Dockerfile, safe `.env.example`, backend verification and root `verify:backend`/`verify:all` scripts.
5. Run deterministic auth/security unit tests; run bounded Compose health/auth smoke when Docker is available and record otherwise `UNAVAILABLE`.
