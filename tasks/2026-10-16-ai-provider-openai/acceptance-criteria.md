# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-AI-1` | `REQ-AI-PROVIDER` | `EV-AI-1` | Both seams support `openai` mode via `CHATTY_BOT_PROVIDER_API`/`CHATTY_RAG_EMBEDDING_API` (default `ollama` unchanged): the bot posts `/v1/chat/completions` and parses `choices[0].message.content`; embeddings post `/v1/embeddings` and parse `data[].embedding` positionally; error kinds and transport injection preserved; pytest covers both modes for both seams. |
| `AC-AI-2` | `REQ-AI-PROVIDER` | `EV-AI-1` | `npm run verify:backend` and `verify:all` are green; `docker compose --env-file <operator-env> config --quiet` passes with the new api-service variables; `.env.example` documents the new knobs. |
| `AC-AI-3` | `REQ-AI-PROVIDER` | `EV-AI-2` | Live AI smoke on the operator stack with `openai` mode: an `is_ai` chat question returns a bot answer from the configured model; RAG document rows stay `UNAVAILABLE` while the inference server has no embeddings endpoint. |

## Evidence contract

`EV-AI-1` contains the pytest/verify receipts plus compose preflight. `EV-AI-2`
contains the live smoke rows (chat question/answer; RAG UNAVAILABLE note).
