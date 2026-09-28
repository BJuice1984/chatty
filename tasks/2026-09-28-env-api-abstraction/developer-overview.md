# Second implementation package — frontend environment/API boundary

This package follows the backend deployment foundation. Its roadmap alias is `env-api-abstraction`; the repository ALK package id is `2026-09-28-env-api-abstraction`. The execution PR targets `dev`; this plan was authored on `feature/agent-harness`.

Create `feature/2026-09-28-env-api-abstraction` from the accepted backend commit on `dev`. The feature branch is only an execution branch; independent review, freeze and the predecessor PR acceptance remain required.

## Scope

Create one typed environment boundary for Practicum and own modes, make HTTP/WS/file URL construction configurable, preserve the existing `MessagesController` as a compatibility adapter, and remove hardcoded public backend URLs from avatar templates. State-changing requests must have an explicit CSRF input path and WebSocket construction must accept the configured origin.

The worker owns only the paths listed in the manifest. It must not migrate pages, change the Router/Store/Block kernel, edit the architecture guard, add backend code, or delete legacy APIs. The compatibility adapter remains until the cutover stage proves both modes.

## Required evidence

`npm run verify` is the deterministic gate. Add focused env/transport tests for URL joining, mode selection, CSRF forwarding, WS origin input, and error normalization. Run a bounded template scan for public URL literals. After backend acceptance, run a bounded own-mode health/auth compatibility smoke and a Practicum smoke; if either external service is unavailable, record `UNAVAILABLE` with the missing dependency and reproduction command.

No secrets belong in `.env.example`, the plan, or evidence. No production promotion is claimed.
