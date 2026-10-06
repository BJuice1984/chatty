# Stage 8 — Document ingestion and RAG (revision 3)

Roadmap alias: `backend-docs-rag`; ALK package id: `2026-09-28-backend-docs-rag`. Branch `feature/2026-09-28-backend-docs-rag` is created from the accepted `origin/dev` at `ac50c6f6d7e7bac8a3af33aaa7aaa792aaca028a` (stages 5–6 accepted through PR #16; the stage 2–4 and 7 frontend contour merged through PRs #17–#20). Revision 1 was authored against a stale `main@d79de677` base; this revision refreezes the package onto the real `dev` tree.

Consume the stage 6 file contract and implement document/file relations, parsers for `.docx`, bounded `.doc` conversion, text-PDF and `.xlsx`, chunking/embeddings, ready/failed states, admin ingestion and authorized top-k retrieval. Every failure is explicit; failed/partial documents are never searchable as ready. Ollama, LibreOffice and pgvector are external gates with a strict `UNAVAILABLE` policy.

This stage does not edit chat/file models, central route composition (`backend/app/main.py`, `backend/app/api/v1/router.py`), `backend/app/ws`, frontend files, Compose or CI. The manual checklist is part of the package and must be completed or marked unavailable with a reason.

## Verified base-tree facts (read at the base SHA)

- **Composition seam.** `backend/app/api/v1/router.py` (readOnly) exposes `register_domain_router(router)` and `build_api_router(domain_routers=None)`; `backend/app/main.py` (readOnly) mounts `build_api_router()` under the API prefix. A domain router appended through the seam before `create_app()` is therefore included without touching either file.
- **Mounting point.** `backend/app/api/v1/endpoints/__init__.py` (added to the write-set in r2) is executed before `app.api.v1.router` finishes loading, because `main.py` imports `app.api.v1.endpoints.health` first. It imports the new `documents` module and calls `documents.register_domain()` at the end of package init. `register_domain()` uses a local import of `register_domain_router` because router.py imports this package while it is still initializing — a module-level import would be circular. Invariant: every current entry point (uvicorn `app.main:app`, `backend/tests/conftest.py`, `app.seed`, Alembic env) reaches `app.api.v1.router` only through `app.main`; no code imports `app.api.v1.router` cold. `register_domain()` catches the partial-module `ImportError` of a hypothetical cold `import app.api.v1.router` and re-raises it with an explicit "import app.main, not app.api.v1.router" message, and a composition test asserts the mounted document routes.
- **Authorization reuse.** `backend/app/core/deps.py` (readOnly) already provides `require_roles(*roles)` and `get_current_user`; the ingestion endpoint uses `require_roles('admin')` (the `role` column and the env-driven admin seed exist since stage 5). Retrieval scope reuses the chats membership check (`ChatService.require_member`).
- **File contract.** `backend/app/models/file.py` / `backend/app/schemas/file.py` / `backend/app/repositories/files.py` / `backend/app/services/files.py` (all readOnly): `File(chat_id, owner_id, object_key, original_name, content_type, size_bytes, status)` with pending/ready/failed states, uploads going through the `ObjectStorage` protocol. Ingestion consumes only files with `status='ready'`, downloads bytes through the same `ObjectStorage` seam and records the `file_id` on the document row for traceability.
- **Settings.** `backend/app/core/config.py` is untouched (forbidden). RAG runtime settings live in `backend/app/ingestion/config.py`: `CHATTY_RAG_EMBEDDING_URL`, `CHATTY_RAG_EMBEDDING_MODEL`, `CHATTY_RAG_CONVERTER_COMMAND`, `CHATTY_RAG_CONVERTER_TIMEOUT_SECONDS`, `CHATTY_RAG_TOP_K_MAX`, each with a safe default. The five operator variables are documented in `backend/.env.example` (added to the write-set in r3); no secrets are published there.
- **Dependencies.** `backend/pyproject.toml` (added to the write-set in r2) gains `python-docx`, `pypdf` and `openpyxl`; `httpx` moves from the test extra to runtime dependencies for the local Ollama embedding client.
- **Embedding storage.** Chunks persist a portable JSON float vector; top-k cosine similarity is computed in the service after a chat-scoped candidate query. pgvector-native storage/indexing is an explicit hardening carry-forward: the deterministic test gate runs on in-memory sqlite (`backend/tests/conftest.py`), the Compose stack ships plain `postgres:16-alpine`, and course-scale corpora do not need an ANN index. No cloud fallback exists at any layer.
- **Migrations.** Hand-written `backend/alembic/versions/003_documents_chunks.py` (`001_users`, `002_chat_messages_files` exist at the base).
- **Test gate.** `backend/verify.sh` = `pytest -q tests` + `alembic heads`, run inside an isolated Docker container with the backend test extra installed (the receipt pattern used by stages 5–6). Unit tests cover parsers, the chunker, converter bounds (injected command) and the embedding seam; integration tests cover the admin gate, member scope, `file_id` traceability and failed-document exclusion; binary fixtures (`.docx`, text-PDF, `.xlsx`, `.doc`) are committed under `backend/tests/fixtures/documents`.

## Environment gates (host facts recorded at refreeze time)

- Docker: available — the isolated test container runs the deterministic gate.
- LibreOffice (`soffice`): present on this host — the live bounded `.doc` conversion checklist row is executable.
- Ollama: **not installed** — `RAG-OLLAMA` is recorded `UNAVAILABLE` with the probe command; it is never converted to PASS.
- pgvector: absent by design (see embedding storage above).

## Refreeze delta r1 → r2

1. `baseRevision` and the launch gate moved from stale `main@d79de677` to the accepted `dev@ac50c6f` tree.
2. Write-set reconciliation with the real tree: `backend/pyproject.toml` and `backend/app/api/v1/endpoints/__init__.py` added (r1 had no legal place for parser dependencies or route mounting); readOnly extended with `core/deps.py`, `services/chats.py`, `services/files.py`, `tests/conftest.py`.
3. `artifactPaths` converted to per-attempt `result`/`review` templates required by ALK 2.15 rework cycles.
4. `leadOwned` records the controller-owned plan package and progress journal surviving in the implementation delta.
5. `compatibility` documents the endpoint-mounting, embedding-storage, dependency, converter and settings decisions; `releaseTarget`/`sandbox` no longer claim a pgvector environment that the shipped Compose does not provide.

## Refreeze delta r2 → r3 (plan-audit round 1, CHANGES_REQUIRED → fixed)

1. `planFiles` sorted lexicographically (round-1 MEDIUM; `plan lock-create` rejects unsorted lists — the stage 7 blocker). `plan-review.json` joins the sorted list once the review file exists, before the lock.
2. `validation.commands[1]` rewritten to the reproducible stage 5–6 precedent form `(cd backend && PYTHONPATH=. python3 -m pytest tests/unit/ingestion tests/integration/rag)` (round-1 MEDIUM; the bare `python3 -m pytest backend/…` form cannot run from the repository root).
3. `backend/.env.example` added to the writes and the five operator RAG variables documented there (round-1 LOW; without it the natural stage 5–6 habit of documenting env vars would edit a path outside the write-set).
4. `register_domain()` gets the explicit cold-import guard message (round-1 LOW; recorded in the mounting-point contract above and in `plan.md`).
