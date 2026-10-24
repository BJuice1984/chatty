# Independent plan review request (revision 3, round 2 — focused)

Round 1 returned `CHANGES_REQUIRED` with four findings (2 MEDIUM, 2 LOW); all are fixed in r3. This is a focused round: verify the fixes and that nothing else regressed.

1. **planFiles sorting (MEDIUM 1).** `planFiles` is now lexicographically sorted (`acceptance-criteria.md` first). `plan-review.json` will join the sorted list once the review file exists, before `plan lock-create`.
2. **Reproducible validation command (MEDIUM 2).** `validation.commands[1]` is now `(cd backend && PYTHONPATH=. python3 -m pytest tests/unit/ingestion tests/integration/rag)` — the stage 5–6 precedent form; the authoritative gate remains `backend/verify.sh` inside the isolated test container.
3. **`.env.example` ownership (LOW 3).** `backend/.env.example` is added to the workstream writes; the five operator RAG variables (`CHATTY_RAG_EMBEDDING_URL`, `CHATTY_RAG_EMBEDDING_MODEL`, `CHATTY_RAG_CONVERTER_COMMAND`, `CHATTY_RAG_CONVERTER_TIMEOUT_SECONDS`, `CHATTY_RAG_TOP_K_MAX`) will be documented there without secrets.
4. **Cold-import guard (LOW 4).** The mounting-point contract now requires `register_domain()` to catch the partial-module `ImportError` of a direct `import app.api.v1.router` and re-raise with an explicit "import app.main, not app.api.v1.router" message, plus the composition test asserting mounted routes.

Everything else (base `dev@ac50c6f`, write-set reconciliation, composition seam reasoning, JSON-vector embeddings with the pgvector carry-forward, `UNAVAILABLE` policy for the absent Ollama, admin/member scope guards) is unchanged from round 1 and was confirmed by it. Return `PASS`, `CHANGES_REQUIRED` or `BLOCKED` with exact paths.
