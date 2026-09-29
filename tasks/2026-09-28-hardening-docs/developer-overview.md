# Stage 11 — Hardening, history and documentation

Roadmap alias: `hardening-docs`; ALK package id: `2026-09-28-hardening-docs`. Create `feature/2026-09-28-hardening-docs` from accepted `main` after stages 7, 9 and 10; this draft was authored on `feature/agent-harness`.

Harden the shared WebSocket transport with reconnect/backoff and deterministic close cleanup, add chat history pagination in the UI, and document the local owned-backend runbook, release boundary and progress. Preserve the agent harness, architecture guard, course CI, Netlify configuration and principles authority. This is the final stage and owns the final implementation/audit evidence boundary; it does not claim production promotion.

The reconnect/history browser checklist is required. A live backend/Ollama/MinIO absence is `UNAVAILABLE`, while deterministic frontend and documentation checks still run.
