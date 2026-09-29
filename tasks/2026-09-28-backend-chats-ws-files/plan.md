# Implementation plan

1. Define chat/member/message/file models, schemas and repositories against the stage 5 database/auth contract.
2. Implement service authorization, ordered history with bounded pagination, idempotent message creation and typed event envelopes.
3. Add HTTP chat/file endpoints and WebSocket hub/router with cookie-auth and membership checks.
4. Add migrations, unit/integration tests and a file contract handoff including `file_id`, status, content type, size, owner and authorized download behavior.
5. Run deterministic tests and bounded Docker/MinIO/WS flows, reporting missing services as `UNAVAILABLE`.
