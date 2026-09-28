# Independent plan review request

Audit this package read-only for backend path ownership, cookie/CSRF/origin and secret handling, migration/seed determinism, the root npm metadata boundary, and the domain-router seam consumed by stages 6/8/9. Confirm no course CI/deploy writes or production claim. Return `PASS`, `CHANGES_REQUIRED` or `BLOCKED` with exact paths.
