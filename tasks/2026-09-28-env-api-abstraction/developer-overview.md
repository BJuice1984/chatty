# Stage 1 — Environment and API abstraction

This package is the first implementation stage from `tasks/2026-09-28-ai-messenger-master-plan.md`. Its roadmap alias is `env-api-abstraction`; the repository ALK package id is `2026-09-28-env-api-abstraction`.

The execution branch must be created from `main` at the accepted base revision and named `feature/2026-09-28-env-api-abstraction`. This package is authored on `feature/agent-harness`; that branch is only the planning source and is not an execution authorization.

## Scope

Create one typed environment boundary for Practicum and own modes, make HTTP/WS/file URL construction configurable, preserve the existing `MessagesController` as a compatibility adapter, and remove hardcoded public backend URLs from avatar templates. State-changing requests must have an explicit CSRF input path and WebSocket construction must accept the configured origin.

The worker owns only the paths listed in the manifest. It must not migrate pages, change the Router/Store/Block kernel, edit the architecture guard, add backend code, or delete legacy APIs. The compatibility adapter remains until the cutover stage proves both modes.

## Required evidence

`npm run verify` is the deterministic gate. Add focused env/transport tests for URL joining, mode selection, CSRF forwarding, WS origin input, and error normalization. Run a bounded template scan for public URL literals. Practicum smoke is manual evidence; if the external service is unavailable, record `UNAVAILABLE` with the missing dependency and reproduction command.

No secrets belong in `.env.example`, the plan, or evidence. No production promotion is claimed.
