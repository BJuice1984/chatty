# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-ENV-API-1` | `REQ-ENV-API` | `EV-ENV-API-1` | `npm run verify` passes; focused tests prove mode selection, safe URL joining, CSRF forwarding, WS origin input and normalized errors. |
| `AC-ENV-API-2` | `REQ-ENV-API` | `EV-ENV-API-2` | After backend acceptance, own mode consumes its published health/auth endpoint contract; templates contain no hardcoded public backend URL, Practicum mode remains selectable and the message-controller compatibility contract remains usable. External availability is PASS or explicit UNAVAILABLE. |

## AC-ENV-API-1 — deterministic transport boundary

`npm run verify` passes. Focused tests prove mode selection, safe joining of configured HTTP/WS/file bases, explicit CSRF forwarding for state-changing requests, WS origin input, and normalized transport errors.

Evidence: `EV-ENV-API-1` at `work/2026-09-28-env-api-abstraction/evidence/WS-ENV-API/EV-ENV-API-1.json`.

## AC-ENV-API-2 — compatibility and URL hygiene

After the backend package is accepted, own mode consumes its published health/auth endpoint contract. Avatar/file templates contain no hardcoded public backend URL, Practicum development mode remains selectable, and the existing message controller still exposes its compatibility behavior. A bounded internal-backend and Practicum smoke is `PASS` or explicitly `UNAVAILABLE`; unavailable external service is never represented as `PASS`.

Evidence: `EV-ENV-API-2` at `work/2026-09-28-env-api-abstraction/evidence/WS-ENV-API/EV-ENV-API-2.json`; the receipt separates internal-backend and Practicum availability.
