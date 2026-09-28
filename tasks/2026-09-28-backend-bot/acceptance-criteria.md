# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BOT-1` | `REQ-BE-BOT` | `EV-BOT-1` | One AI message creates at most one active bot run and a bounded response; retries and provider timeout are explicit. |
| `AC-BOT-2` | `REQ-BE-BOT` | `EV-BOT-2` | Search and optional attachment remain authorized to the source chat/user, with no cloud fallback or prompt scope escape. |

## Evidence contract

`EV-BOT-1` contains deterministic idempotency/retry/unit receipts. `EV-BOT-2` contains authorization checks and the Ollama manual checklist. Provider unavailability is `UNAVAILABLE`, never synthetic PASS.
