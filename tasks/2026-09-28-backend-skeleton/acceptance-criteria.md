# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-SKELETON-1` | `REQ-BE-SKELETON` | `EV-BE-SKELETON-1` | Backend auth/security unit tests, migration baseline, cookie/refresh/logout and seed contracts pass without committed secrets. |
| `AC-BE-SKELETON-2` | `REQ-BE-SKELETON` | `EV-BE-SKELETON-2` | Compose, app/router seam and root backend verification contract are deterministic; live Docker evidence is PASS or explicit UNAVAILABLE. |

## Evidence contract

`EV-BE-SKELETON-1` separates deterministic Python tests from live dependencies. `EV-BE-SKELETON-2` includes `backend/verify.sh`, `docker compose config --quiet`, root script receipts and bounded health/auth smoke. Missing Docker is never converted to PASS.
