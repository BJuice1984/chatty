# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-KERNEL-1` | `REQ-KERNEL` | `EV-KERNEL-1` | Router, Store and Block tests cover params, lazy-load failure, 404, shallow-equal updates and unsubscribe after `destroy()`. |
| `AC-KERNEL-2` | `REQ-KERNEL` | `EV-KERNEL-2` | A `TRANSITIONAL_DEBT` handoff lists resolved and remaining guard-relevant entries and is consumable by stage 3. |

## Evidence contract

`EV-KERNEL-1` is the focused test and `npm run verify` receipt. `EV-KERNEL-2` is the handoff receipt containing source revision, plan digest, resolved entries, remaining entries and the next owner. A missing external service is not relevant to this stage and must not be hidden as a synthetic pass.
