# Stage 6 — Backend chats, WebSocket and files

Roadmap alias: `backend-chats-ws-files`; ALK package id: `2026-09-28-backend-chats-ws-files`. Revision 4 is based on the accepted `origin/dev@f56318c5fce969b3243b69c8365b8880b6813e84`; the execution branch targets `dev` and must be created from that exact SHA at freeze.

Implement authorized chats, members, ordered/cursor-paginated messages, typed WebSocket envelopes and authenticated file upload/download through the existing RustFS S3-compatible service. Consume the stage 5 auth/database seams. The file model/schema/repository contract is a formal handoff for stage 8 RAG and stage 9 bot; those stages must not infer it from UI code.

The worker owns only chat/file domain code, migrations and deterministic in-process domain tests. The controller owns the narrow integration seams required to register the new HTTP/WebSocket routers, pass RustFS credentials/configuration into the API container and add the synchronous `boto3` S3 client dependency. No frontend files, documents/RAG or bot code are owned here. Every chat, message and file operation must reject unauthenticated and non-member access. Live Docker, RustFS and WebSocket evidence is `PASS` or explicit `UNAVAILABLE`; it is never silently skipped.
