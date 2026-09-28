# Stage 6 — Backend chats, WebSocket and files

Roadmap alias: `backend-chats-ws-files`; ALK package id: `2026-09-28-backend-chats-ws-files`. Create `feature/2026-09-28-backend-chats-ws-files` from accepted `main` after stage 5 is available; this draft was authored on `feature/agent-harness`.

Implement authorized chats, members, ordered/paginated messages, a typed WebSocket envelope and authenticated MinIO upload/download. Consume the stage 5 app/router and auth seams. The file model/schema/repository contract is a formal handoff for stage 8 RAG and stage 9 bot; those stages must not infer it from UI code.

No frontend files, central backend composition files, documents/RAG or bot code are owned here. Every chat/file operation must reject unauthenticated and non-member access, and live Docker/MinIO evidence remains explicitly unavailable when dependencies are absent.
