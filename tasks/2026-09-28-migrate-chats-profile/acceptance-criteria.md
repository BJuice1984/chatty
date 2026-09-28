# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-FE-MIGRATE-1` | `REQ-FE-MIGRATION` | `EV-FE-MIGRATE-1` | Chats and profile compile behind feature-owned ports and preserve the Block/Handlebars UI contract. |
| `AC-FE-MIGRATE-2` | `REQ-FE-MIGRATION` | `EV-FE-MIGRATE-2` | Listed legacy page/controller/API files are removed only after replacement and bounded Practicum smoke; `MessagesController.ts` remains. |

## Evidence contract

`EV-FE-MIGRATE-1` is the verify and feature-boundary test receipt. `EV-FE-MIGRATE-2` includes the old-to-new path inventory, deletion diff, and Practicum smoke (`PASS` or explicit `UNAVAILABLE`).
