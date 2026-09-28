# Implementation plan

1. Define provider and search-tool protocols that consume the accepted RAG result and chat/file contracts.
2. Add bot run model/schema/service/endpoint and migration with queued/running/succeeded/failed states, retry budget and idempotency key.
3. Implement local Ollama provider defaults, prompt/data-scope boundary, optional authorized attachment and bounded timeout behavior.
4. Add unit/integration tests for duplicate delivery, unauthorized attachment, provider timeout and failed-run recovery.
5. Run deterministic bot tests and complete `bot-checklist.md`; record Ollama absence as `UNAVAILABLE`.
