# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-CHAT-1` | `REQ-BE-CHAT` | `EV-BE-CHAT-1` | Membership authorization, ordered history pagination, typed WS send/receive and authenticated file upload/download pass deterministic tests. |
| `AC-BE-CHAT-2` | `REQ-BE-CHAT` | `EV-BE-CHAT-2` | The accepted file contract is explicit and consumable by stages 8 and 9; non-member/unauthenticated negative cases are recorded. |

## Evidence contract

`EV-BE-CHAT-1` contains unit/integration receipts. `EV-BE-CHAT-2` contains the file contract handoff and negative authorization matrix. Docker/MinIO/WebSocket live portions are `PASS` or `UNAVAILABLE`, never silently skipped.
