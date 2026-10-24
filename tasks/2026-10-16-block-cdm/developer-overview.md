# Developer overview — 2026-10-16-block-cdm

Core lifecycle activation, frontend-only. Key files: `src/core/Block.ts`
(dispatchComponentDidMount at the bottom of the class; `_hbsChildren` captured
at compile), `src/utils/Router.ts` (module `render()` helper), the two
consumer pages. Style: 4-space, single quotes, no semicolons, `.ts` imports,
Russian comments matching the codebase tone. Tests next to sources; jsdom +
chai + sinon available. `main.ts` is forbidden — the bootstrap double-fetch
(bootstrap + CDM) is accepted as idempotent and must be visible in the smoke
log, not engineered around. Live stack facts: same as the previous packages
(operator env, front on 3001, smoke account manual.smoke2@example.com /
ManualSmoke-2026, port 3000 busy).
