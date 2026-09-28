# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-HARDEN-1` | `REQ-HARDEN-DOCS` | `EV-HARDEN-1` | WS reconnect/backoff, close cleanup and UI history pagination have regression coverage and bounded manual browser evidence without duplicate subscriptions/messages. |
| `AC-HARDEN-2` | `REQ-HARDEN-DOCS` | `EV-HARDEN-2` | Frontend/backend/all gates, local runbook, rollback/preflight notes and final audit bind to exact revisions without production promotion. |

## Evidence contract

`EV-HARDEN-1` contains focused tests and `HARDEN-RECONNECT-HISTORY` browser evidence. `EV-HARDEN-2` contains `npm run verify`, `npm run verify:all`, Compose config, docs/progress and independent final audit receipts. External dependencies are explicit `UNAVAILABLE` when missing.
