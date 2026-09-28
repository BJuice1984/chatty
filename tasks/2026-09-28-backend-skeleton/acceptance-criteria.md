# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-SKELETON-1` | `REQ-BE-SKELETON` | `EV-BE-SKELETON-1` | Backend auth/security unit tests, migration baseline, cookie/refresh/logout and seed contracts pass without committed secrets. |
| `AC-BE-SKELETON-2` | `REQ-BE-SKELETON` | `EV-BE-SKELETON-2` | Compose, health/readiness, migrations/seed, app/router seam, internal deployment runbook and root backend verification contract are deterministic; target-environment evidence is PASS or explicit UNAVAILABLE. Local-model verification is not required. |

## Evidence contract

`EV-BE-SKELETON-1` separates deterministic Python tests from live dependencies. `EV-BE-SKELETON-2` includes `backend/verify.sh`, `docker compose config --quiet`, root script receipts, the internal deployment runbook and bounded health/auth smoke. Missing Docker or target-network access is never converted to PASS. Ollama and model checks are explicitly deferred.
