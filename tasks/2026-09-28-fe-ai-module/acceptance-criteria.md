# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-AI-UI-1` | `REQ-FE-AI` | `EV-AI-UI-1` | AI searching/typing, success, empty-result and error states render through the feature module and Block/Handlebars contract. |
| `AC-AI-UI-2` | `REQ-FE-AI` | `EV-AI-UI-2` | Arbitrary HTML and unsafe URL schemes are rejected; valid configured document links preserve `file_id` and safe download behavior. |

## Evidence contract

`EV-AI-UI-1` is the feature/verify receipt. `EV-AI-UI-2` is the `AI-UI-RENDER-SAFETY` browser/manual and deterministic rendering receipt. Missing bot/backend is `UNAVAILABLE`, never a synthetic PASS.
