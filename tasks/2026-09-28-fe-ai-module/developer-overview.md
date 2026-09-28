# Stage 10 — AI assistant frontend module

Roadmap alias: `fe-ai-module`; ALK package id: `2026-09-28-fe-ai-module`. Create `feature/2026-09-28-fe-ai-module` from accepted `main` after stages 7 and 9; this draft was authored on `feature/agent-harness`.

Implement the standalone AI assistant feature: controller/store/ports, searching/typing/success/empty/error states, safe document cards and attachment rendering. Consume the stage 7 adapter/WS gateway and stage 9 bot contract. The shared message component and composition root remain owned by stage 7; this package exposes its module through the registry seam rather than editing another feature.

No arbitrary HTML or unsafe URL scheme may enter the DOM from bot content. The browser checklist is mandatory manual evidence; absent backend/Ollama is `UNAVAILABLE`, while safe-rendering unit tests remain deterministic.
