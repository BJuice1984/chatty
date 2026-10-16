# Stage 13: ai-provider-openai

Single workstream WS-AI-PROVIDER. The operator's inference server
(192.168.1.121:8080, llama.cpp, Qwen3.5-9B-Q4_K_M) speaks the OpenAI-compatible
protocol and has NO embeddings endpoint (501) and NO Ollama `/api/chat` (404).
The backend seams currently speak Ollama only.

1. `backend/app/bot/config.py`: `PROVIDER_API = 'CHATTY_BOT_PROVIDER_API'`
   ('ollama' | 'openai'). Invalid/unknown values fall back to 'ollama'
   silently — the module convention for malformed env values (settings parse
   per request, so fail-fast would turn an operator typo into per-request
   500s; a typo surfaces observably as provider_failed on the first call).
2. `backend/app/bot/provider.py`: `OpenAIChatProvider` — POST
   `{url}/v1/chat/completions` with `{model, messages, stream:false}`, parse
   `choices[0].message.content` (same error-kind dictionary as the Ollama
   client: timeout/unreachable/failed/malformed; an empty content maps to
   'provider_malformed' exactly like the Ollama branch); `default_provider` picks the class by `bot.provider_api`.
3. `backend/app/ingestion/config.py`: `EMBEDDING_API =
   'CHATTY_RAG_EMBEDDING_API'` with the SAME symmetric policy as item 1
   (unknown value → 'ollama' fallback).
4. `backend/app/ingestion/embeddings.py`: `OpenAIEmbeddingProvider` — POST
   `{url}/v1/embeddings` with `{model, input}`, parse `data[].embedding`
   positionally with the same count/malformed/empty guards; factory picks by
   `rag.embedding_api`.
5. Tests: extend `backend/tests/unit/bot/test_config.py` (api knob parsing,
   including the invalid-value → 'ollama' fallback), `test_provider.py`
   (openai request/response + error kinds via injected transport + a
   factory-dispatch test: settings with api='openai' → default_provider
   returns the OpenAI class), `backend/tests/unit/ingestion/test_embeddings.py`
   (openai positional parse + guards + the same factory-dispatch test; RAG
   knob-parsing cases also live here — there is no ingestion test_config.py).
6. `docker-compose.yml`: pass `CHATTY_BOT_*`/`CHATTY_RAG_*` through the api
   service environment. Committed defaults are mode-neutral:
   `CHATTY_BOT_PROVIDER_API:-ollama`, `CHATTY_RAG_EMBEDDING_API:-ollama`,
   URL defaults `127.0.0.1:11434` — the openai mode and the operator's
   192.168.1.121 address live ONLY in the operator env file (never committed).
7. `backend/.env.example`: document the new knobs. `docs/deployment/
   own-backend.md` — rewrite the Ollama-specific places explicitly: preflight
   step 2 (two provider modes; ollama pulls only for ollama mode), the
   `curl :11434/api/tags` line in Start-and-verify (mode-dependent check),
   and the notes-bullet that claims compose does not wire the AI variables
   (it will, after item 6) — plus the embeddings-501 UNAVAILABLE policy for
   openai servers without an embeddings endpoint.
8. Live smoke (operator stack, `openai` mode, model id from `/v1/models`):
   `is_ai` chat question → bot answer; RAG rows UNAVAILABLE.

Verification: `npm run verify:backend`, `PYTHON_BIN=... npm run verify:all`,
`docker compose --env-file ~/.config/chatty/own-backend.env config --quiet`,
live smoke rows.
