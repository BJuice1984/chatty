# Bot evidence checklist

Record source revision, plan digest, model/provider configuration, timeout and result.

| Case | Required observation | Result |
| --- | --- | --- |
| BOT-IDEMPOTENCY | Duplicate delivery leaves one active run and one final response. | PASS / FAIL |
| BOT-RETRY | Provider timeout reaches bounded failed/retry state. | PASS / FAIL / UNAVAILABLE |
| BOT-RAG-SCOPE | Search uses only source-chat authorized ready documents. | PASS / FAIL / UNAVAILABLE |
| BOT-ATTACHMENT | Optional file_id is authorized and traceable. | PASS / FAIL / UNAVAILABLE |
| BOT-OLLAMA | Configured local model answers without cloud fallback. | PASS / FAIL / UNAVAILABLE |
