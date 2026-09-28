# Stage 9 — Durable AI bot

Roadmap alias: `backend-bot`; ALK package id: `2026-09-28-backend-bot`. Create `feature/2026-09-28-backend-bot` from accepted `main` after stages 5, 6 and 8; this draft was authored on `feature/agent-harness`.

Implement a provider-independent durable bot run: consume chat messages, use the stage 8 search tool, persist run state, enforce bounded retries/idempotency and optionally attach an authorized `file_id`. The provider defaults to local Qwen3-14B Q4 through a configurable Ollama seam; no cloud fallback is allowed.

The bot stage owns only its bot package, model/schema/service/endpoint/migration and tests. It does not edit chat/file/RAG models, central route composition or frontend files. Missing Ollama is an explicit manual `UNAVAILABLE` result while deterministic idempotency and authorization tests remain required.
