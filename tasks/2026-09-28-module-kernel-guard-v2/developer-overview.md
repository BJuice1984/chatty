# Stage 3 — Module kernel, guard v2 and auth boundary

Roadmap alias: `module-kernel-guard-v2`; ALK package id: `2026-09-28-module-kernel-guard-v2`. Execute from `feature/2026-09-28-module-kernel-guard-v2`, based on accepted `main`; this draft was authored on `feature/agent-harness`.

Introduce typed module registration and the strict architecture guard, then migrate auth behind a feature boundary. Consume stage 2's `TRANSITIONAL_DEBT` handoff before editing the guard's debt map. The guard must reject upward-layer and cross-feature runtime imports, while type-only API references remain explicitly classified. Auth owns its controller/store/ports and login/register feature pages; chats/profile migration is stage 4.

No backend, Router/Store/Block, legacy deletion or composition-root writes are authorized here. Preserve the course workflows and deploy configuration.
