# Stage 7 — Frontend API and WebSocket cutover

Roadmap alias: `api-cutover`; ALK package id: `2026-09-28-api-cutover`. Create `feature/2026-09-28-api-cutover` from accepted `main` after stages 4–6 are accepted; this draft was authored on `feature/agent-harness`.

Own the frontend composition root and adapter layer for Practicum and the owned backend: auth/chats/profile HTTP adapters, chat WebSocket gateway, module registration and the shared message renderer. Prove both modes and clean WS close before calling the cutover complete. This stage consumes feature ports, backend contracts and the stage 1 environment boundary; it does not edit legacy pages/controllers/API paths (stage 4 owns their deletion) or the auth guard/guard map (stage 3 owns it).

Both runtime modes are compatibility targets, not production environments. External backend/Docker availability is recorded as bounded evidence and never hidden.
