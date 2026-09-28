# Stage 2 — Router, Store and Block kernel

Roadmap alias: `kernel-router-store`; ALK package id: `2026-09-28-kernel-router-store`. Create `feature/2026-09-28-kernel-router-store` from the accepted `main` base. The package is authored on `feature/agent-harness` and is not an execution authorization.

This stage makes routing and state lifecycle safe: parameterized/lazy routes, explicit 404 and auth-guard seams, typed Store slices with shallow comparison, and deterministic `Block.destroy()` unsubscription. It consumes the stage 1 environment contract but does not edit stage 1 files, feature modules, the architecture guard or page migrations.

The Store refactor must emit a concrete `TRANSITIONAL_DEBT` handoff listing resolved and remaining entries for stage 3. Stage 3 alone may edit the guard debt map. Preserve the Block/Handlebars architecture and all course CI and deploy paths.
