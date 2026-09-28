# Implementation plan

1. Inspect the accepted stage 7 WS gateway and stage 2 Block lifecycle contract.
2. Add bounded reconnect/backoff, one-subscription semantics, explicit close cleanup and regression tests to `WSTransport`.
3. Add history controller/view/types with `before_id` pagination, loading/error/empty states and no duplicate messages.
4. Complete the reconnect/history browser checklist and run deterministic frontend/backend/all gates.
5. Add local owned-backend deployment/rollback documentation and a progress entry that records exact evidence and no production claim; request independent final implementation audit.
