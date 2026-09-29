# Implementation plan

1. Consume and record the stage 6 file contract: ownership, file_id, content type, size, storage and authorization.
2. Add document/chunk models, schemas, repository/service and migration with ready/processing/failed states.
3. Implement deterministic parsers for `.docx`, text-PDF and `.xlsx`; isolate `.doc` conversion behind a bounded subprocess timeout and explicit failure.
4. Add chunking/embedding provider seams, admin ingestion endpoint and membership-scoped top-k retrieval with file_id traceability.
5. Add fixed fixtures, parser/unit/integration tests and complete `rag-checklist.md` for Ollama/pgvector/manual retrieval evidence.
