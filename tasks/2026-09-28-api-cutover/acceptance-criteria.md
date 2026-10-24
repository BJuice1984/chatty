# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-CUTOVER-1` | `REQ-API-CUTOVER` | `EV-CUTOVER-1` | Practicum and owned mode adapters compile through the unchanged feature ports and the composition root selects them without upward or cross-feature runtime imports; the legacy `src/api` classes and `MessagesController` are deleted with no remaining import. |
| `AC-CUTOVER-2` | `REQ-API-CUTOVER` | `EV-CUTOVER-2` | Both mode smoke flows and clean WebSocket close pass before cutover is accepted; unavailable external services are explicit. |

## Evidence contract

`EV-CUTOVER-1` is the deterministic verify/build and adapter contract receipt. `EV-CUTOVER-2` is the bounded `CUTOVER-DEV-LOGIN`, `CUTOVER-OWN-AUTH-CHAT-FILE` and `CUTOVER-WS-CLOSE` receipt. A missing Practicum/backend/MinIO dependency is `UNAVAILABLE`, not PASS. Legacy deletion (`src/api`, `MessagesController`) is claimed by this stage per the stage 4 launchGate handoff and lands only after the replacement adapters compile.
