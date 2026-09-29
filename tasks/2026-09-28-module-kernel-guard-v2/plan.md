# Implementation plan

1. Read the stage 2 handoff and map current imports against the documented layer rules.
2. Add typed module contracts, a registry with deterministic collision behavior and an application composition seam.
3. Update `guard-architecture.mjs` to strict v2: upward/cross-feature runtime imports, dynamic import boundaries and debt-map cleanup are explicit.
4. Move auth controller/store/ports and login/register pages behind the feature module; retain compatibility only where the manifest permits.
5. Run strict guard, registry tests and `npm run verify`; attach the debt-map reconciliation and auth smoke evidence.
