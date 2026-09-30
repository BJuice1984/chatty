# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-CHAT-1` | `REQ-BE-CHAT` | `EV-BE-CHAT-1` | Membership authorization, deterministic cursor history pagination, per-sender message idempotency, typed master-plan-compatible `{type, content}` WS send/receive and authenticated RustFS-backed file upload/download pass deterministic tests. |
| `AC-BE-CHAT-2` | `REQ-BE-CHAT` | `EV-BE-CHAT-2` | The versioned file contract explicitly defines identity, ownership, chat binding, server-generated object key, content metadata, lifecycle status and authorized streaming download; non-member/unauthenticated negative cases and the router/storage integration handoff are recorded. |

## Evidence contract

`EV-BE-CHAT-1` contains deterministic in-process unit/integration receipts. `EV-BE-CHAT-2` contains the file contract handoff, negative authorization matrix and controller-owned router/RustFS wiring receipt. Docker/RustFS/WebSocket live portions are separate bounded checks and are `PASS` or `UNAVAILABLE`, never silently skipped.
