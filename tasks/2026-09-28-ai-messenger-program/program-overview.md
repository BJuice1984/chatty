# AI messenger program overview

This directory is the roadmap index for `tasks/2026-09-28-ai-messenger-master-plan.md`; it is not an executable ALK package. The program is intentionally split into the eleven stage-specific packages below. Each package has its own plan id, branch, review, freeze, worker packet and PR.

The backend package `2026-09-28-backend-skeleton` is `FROZEN` at revision 2 with an independent `READY_TO_FREEZE` review and `plan.lock.json`; the other ten stage packages remain `DRAFT`. The first delivery contour is sequential and targets `dev`: backend deployment foundation first, then frontend environment/API boundary. The remaining packages retain their declared `main@d79de677facf8b06290523f9589808069f6cf621` planning base until their own execution baseline is revised. The harness branch is a planning source only; implementation remains unauthorized until the individual package passes independent review and freeze.

## Current first contour

1. `2026-09-28-backend-skeleton` — `FROZEN`; first PR into `dev`: smallest internal-network backend bundle with health/readiness, auth, database/migrations, Compose and deterministic verification.
2. `2026-09-28-env-api-abstraction` — second PR into `dev`, after the backend PR is accepted: frontend endpoint/environment boundary and compatibility transport.
3. Continue with chat/WS/files and the remaining domain/cutover packages only after the preceding package has passed validation, implementation audit and PR acceptance.

The already deployed local model is deliberately outside this first contour. Its reachability/configuration verification becomes a later explicit gate before RAG/bot work; it is not a dependency of either of the first two packages.

## Stage map

| Master stage | ALK package | Execution branch | Main responsibility | Prerequisite |
| --- | --- | --- | --- | --- |
| 1. env-api-abstraction | `tasks/2026-09-28-env-api-abstraction/` | `feature/2026-09-28-env-api-abstraction` | Typed environment, HTTP/WS/file endpoints, compatibility transport | backend-skeleton accepted in `dev` |
| 2. kernel-router-store | `tasks/2026-09-28-kernel-router-store/` | `feature/2026-09-28-kernel-router-store` | Router, Store, Block lifecycle and debt handoff | 1 |
| 3. module-kernel-guard-v2 | `tasks/2026-09-28-module-kernel-guard-v2/` | `feature/2026-09-28-module-kernel-guard-v2` | Module registry, strict guard and auth feature | 2 |
| 4. migrate-chats-profile | `tasks/2026-09-28-migrate-chats-profile/` | `feature/2026-09-28-migrate-chats-profile` | Chats/profile feature migration and evidence-gated legacy deletion | 3 |
| 5. backend-skeleton | `tasks/2026-09-28-backend-skeleton/` | `feature/2026-09-28-backend-skeleton` | FastAPI/auth/database/Compose/root verification foundation | first package; PR into `dev` |
| 6. backend-chats-ws-files | `tasks/2026-09-28-backend-chats-ws-files/` | `feature/2026-09-28-backend-chats-ws-files` | Authorized chats, WS, MinIO files and file contract | 5 |
| 7. api-cutover | `tasks/2026-09-28-api-cutover/` | `feature/2026-09-28-api-cutover` | Practicum/own adapters, composition root and WS gateway | 4, 5, 6 |
| 8. backend-docs-rag | `tasks/2026-09-28-backend-docs-rag/` | `feature/2026-09-28-backend-docs-rag` | Parsers, embeddings, ready/failed states and scoped retrieval | 5, 6 |
| 9. backend-bot | `tasks/2026-09-28-backend-bot/` | `feature/2026-09-28-backend-bot` | Durable local AI bot, search tool and idempotency | 6, 8 |
| 10. fe-ai-module | `tasks/2026-09-28-fe-ai-module/` | `feature/2026-09-28-fe-ai-module` | AI assistant states, safe document cards and rendering tests | 7, 9 |
| 11. hardening-docs | `tasks/2026-09-28-hardening-docs/` | `feature/2026-09-28-hardening-docs` | WS reconnect/history, local runbook, final gates and audits | 7, 9, 10 |

## Ownership invariants

- The backend skeleton is the first implementation package and owns the internal API deployment seam; the frontend environment package follows it and owns the request boundary while retaining `MessagesController.ts` as a compatibility adapter until hardening.
- Stage 2 emits `TRANSITIONAL_DEBT`; stage 3 alone edits the architecture guard debt map.
- Stage 4 owns legacy page/controller/API deletion; stage 7 owns feature API/WS adapters and composition; stage 10 does not edit the shared message component.
- Stage 5 owns root `package.json`/`package-lock.json`, `backend/verify.sh` and the app/router discovery seam. Stages 6, 8 and 9 own only their domain files and expose routers through that seam.
- Stage 6 publishes the file contract consumed by RAG and bot. Stages 8/9 never rewrite chat/file models.
- Stage 11 owns shared `WSTransport`, history UI and documentation; course CI, `netlify.toml`, `sprint_*`, `deploy` and `docs/project-principles.json` remain protected.

Every package uses `S2` because the individual stage still has elevated architecture, security, browser/data/performance or external-environment risk. The ALK tier request and resolved digest are stored inside each package. Manual/external checks use `PASS`, `FAIL` or `UNAVAILABLE`; unavailable Docker, Ollama, MinIO or Practicum must remain a gate and never become a synthetic pass.

The top-level program remains local-only: no historical Practicum data migration, OCR, multi-tenancy, cloud production deployment or production promotion is included.
