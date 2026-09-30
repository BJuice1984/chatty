# Second implementation package — frontend environment/API boundary

This package follows the backend deployment foundation. Its roadmap alias is `env-api-abstraction`; the repository ALK package id is `2026-09-28-env-api-abstraction`. The execution PR targets `dev`; this plan was authored on `feature/agent-harness`.

Create `feature/2026-09-28-env-api-abstraction` from the accepted backend commit on `dev`. The feature branch is only an execution branch; independent review, freeze and the predecessor PR acceptance remain required.

## Scope

Create one typed environment boundary for Practicum and own modes, make HTTP/WS/file URL construction configurable, preserve the existing `MessagesController` as a compatibility adapter, and remove hardcoded public backend URLs from avatar templates. State-changing requests must have an explicit CSRF input path and WebSocket construction must accept the configured origin.

The worker owns only the paths listed in the manifest. It must not migrate pages, change the Router/Store/Block kernel, edit the architecture guard, add backend code, or delete legacy APIs. The compatibility adapter remains until the cutover stage proves both modes.

## Architecture constraints

`HTTPTransport` is a `utils`-layer module and may consume `src/utils/env.ts`, but
must not import `src/api/errors.ts` or any other higher layer. `ApiError` remains
an API/controller-facing error contract; transport error normalization must stay
transport-neutral and preserve the current public controller behavior.

The avatar component TypeScript files are part of this package's write set. They
must compute the configured file URL with `fileUrl()` and pass the resulting URL
to the existing templates; no side-effect Handlebars helper registration or
`main.ts` change is allowed. The environment reader must expose a narrow,
injectable input seam so focused tests do not depend on browser-only
`import.meta.env` globals.

The three committed examples (`.env.example`, `.env.development` and
`.env.own.example`) require explicit `.gitignore` negations alongside an ignore
rule for populated `.env` files; secrets remain outside Git. The avatar
adapters must preserve the existing caller props (`ChatAvatar` receives `src`,
`UserAvatar` receives `avatar`) and keep the empty-avatar rendering behavior.

## Required evidence

`npm run verify` is the deterministic gate. Add focused env/transport tests for URL joining, mode selection, CSRF forwarding, WS origin input, and error normalization. Run a bounded template scan for public URL literals. After backend acceptance, run a bounded own-mode health/auth compatibility smoke and a Practicum smoke; if either external service is unavailable, record `UNAVAILABLE` with the missing dependency and reproduction command.

No secrets belong in `.env.example`, the plan, or evidence. No production promotion is claimed.
