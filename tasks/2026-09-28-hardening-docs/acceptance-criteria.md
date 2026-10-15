# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-HARDEN-1` | `REQ-HARDEN-DOCS` | `EV-HARDEN-1` | WS reconnect/backoff, close cleanup and UI history pagination have regression coverage and bounded manual browser evidence without duplicate subscriptions/messages. |
| `AC-HARDEN-2` | `REQ-HARDEN-DOCS` | `EV-HARDEN-2` | Frontend/backend/all gates, local runbook, rollback/preflight notes and final audit bind to exact revisions without production promotion. |
| `AC-HARDEN-3` | `REQ-HARDEN-DOCS` | `EV-HARDEN-3` | Stage 10 carry-forward findings (NEW-1, NEW-2/NEW-3, RV5/RV6) and the Block `__children` destroy leak are fixed inside the declared write-set with one regression test per finding and no regression in existing suites. |

## Evidence contract

`EV-HARDEN-1` contains focused tests and `HARDEN-RECONNECT-HISTORY` browser evidence. `EV-HARDEN-2` contains `npm run verify`, `npm run verify:all`, Compose config, docs/progress and independent final audit receipts. `EV-HARDEN-3` contains `npm run verify` with one regression test per carry-forward finding (NEW-1, NEW-2, NEW-3, RV5, RV6, Block `__children` destroy). External dependencies are explicit `UNAVAILABLE` when missing.
