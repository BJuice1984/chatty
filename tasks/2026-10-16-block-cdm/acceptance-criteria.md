# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-CDM-1` | `REQ-BLOCK-CDM` | `EV-CDM-1` | `Router.render` dispatches CDM on the mounted page; `dispatchComponentDidMount` recurses over the SAME child set `destroy()` walks (children + `_hbsChildren`, the dispatch ↔ destroy symmetry invariant); CDM fires exactly once per instance — a same-route revisit (setProps) does not re-dispatch, leave → return mounts a fresh instance with a fresh CDM; Block and Router regression tests cover all of it. |
| `AC-CDM-2` | `REQ-BLOCK-CDM` | `EV-CDM-1` | Consumers migrate: ChatPage fetches chats in `componentDidMount` (constructor workaround removed with its comment), the dormant `AssistantPage.componentDidMount → loadChats` becomes live, and the whole frontend suite stays green. |
| `AC-CDM-3` | `REQ-BLOCK-CDM` | `EV-CDM-2` | Live re-smoke on the operator stack: chat list loads after login without a page reload; /assistant loads its AI chat list on entry; no duplicate-fetch storms in the API log; rows recorded in the evidence artifact. |

## Evidence contract

`EV-CDM-1` carries the `npm run verify` receipt with the new Block/Router
regression tests. `EV-CDM-2` carries the live rows from the running stack.
