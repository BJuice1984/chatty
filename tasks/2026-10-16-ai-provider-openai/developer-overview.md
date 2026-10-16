# Developer overview — 2026-10-16-ai-provider-openai

Backend-only change behind the existing Protocol seams (`BotProvider`,
`EmbeddingProvider`); httpx transport injection keeps tests offline. Style:
single quotes, trailing commas, explicit error kinds. Tests run with
`npm run verify:backend` (pytest). The operator inference server lives at
http://192.168.1.121:8080 (OpenAI-compatible; model id is the full gguf path
from /v1/models); no embeddings endpoint — RAG rows stay UNAVAILABLE. Operator
env: ~/.config/chatty/own-backend.env (add CHATTY_BOT_PROVIDER_API=openai,
CHATTY_BOT_PROVIDER_URL=http://192.168.1.121:8080, CHATTY_BOT_MODEL=<id>).
Frontend untouched; frontend tests stay green via verify:all.
