# Independent plan review request

Audit this package read-only for internal-network deployment scope, health/readiness, cookie/CSRF/origin and secret handling, migration/seed determinism, the root npm metadata boundary, and the domain-router seam consumed by stages 6/8/9. Confirm frontend, Ollama/model verification, course CI/deploy writes and production claims are excluded. Return `PASS`, `CHANGES_REQUIRED` or `BLOCKED` with exact paths.


This is revision 3. Re-check the complete package and confirm that the artifact template correction is the only contract change from the frozen revision 2; read the previous review and revision-2 lock as historical context.
