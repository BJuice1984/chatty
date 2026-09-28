# Stage 8 — Document ingestion and RAG

Roadmap alias: `backend-docs-rag`; ALK package id: `2026-09-28-backend-docs-rag`. Create `feature/2026-09-28-backend-docs-rag` from accepted `main` after stages 5–6; this draft was authored on `feature/agent-harness`.

Consume the stage 6 file contract and implement document/file relations, parsers for `.docx`, bounded `.doc` conversion, text-PDF and `.xlsx`, chunking/embeddings, ready/failed states, admin ingestion and authorized top-k retrieval. Every failure is explicit; failed/partial documents are never searchable as ready. Ollama, LibreOffice and pgvector are external gates with a strict `UNAVAILABLE` policy.

This stage does not edit chat/file models, central route composition, bot code or frontend files. The manual checklist is part of the package and must be completed or marked unavailable with a reason.
