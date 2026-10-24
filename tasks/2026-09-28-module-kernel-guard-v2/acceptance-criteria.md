# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-MODULE-1` | `REQ-MODULE-AUTH` | `EV-MODULE-1` | Registry collision tests pass, auth is behind the feature boundary, and `node .claude/hooks/scripts/guard-architecture.mjs --all --strict` exits 0 with no unresolved owned debt. |

## Evidence contract

`EV-MODULE-1` contains the strict guard receipt, registry/auth tests, the consumed stage 2 handoff and a bounded auth smoke. It records exact source and plan revisions. External Practicum availability is `UNAVAILABLE` when absent, never a synthetic pass.
