# Stage 3 — Module kernel, guard v2 and auth boundary

Roadmap alias: `module-kernel-guard-v2`; ALK package id: `2026-09-28-module-kernel-guard-v2`. Execute from `feature/2026-09-28-module-kernel-guard-v2`, based on the accepted `dev` baseline (`dev@8dffe6d1deafc8b5a5cb20b2ff3996501f34c471`, which contains the accepted stage 2 kernel with its TRANSITIONAL_DEBT handoff) and open the PR into `dev`.

Introduce typed module registration and the strict architecture guard, then migrate auth behind a feature boundary. Consume stage 2's `TRANSITIONAL_DEBT` handoff before editing the guard's debt map. The guard must reject upward-layer and cross-feature runtime imports, while type-only API references remain explicitly classified. Auth owns its controller/store/ports and login/register feature pages; chats/profile migration is stage 4.

No backend, Router/Store/Block, legacy deletion or composition-root writes are authorized here. Preserve the course workflows and deploy configuration.
