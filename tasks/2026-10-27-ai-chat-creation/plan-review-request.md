# Plan review request — 2026-10-27-ai-chat-creation

Independent plan review for the S2 package `tasks/2026-10-27-ai-chat-creation/`
(base dev@353db1a): three explicit AI-chat creation entries (form checkbox,
one-click tile, assistant empty-state) over the existing backend
`is_ai` support; one frontend workstream.

Review focus:
1. Contract widening soundness vs the current port/adapter/controller code
   (ports.ts, api/own.ts:129-131, controller.ts create).
2. UI seams: checkbox read at submit (hbs-children re-instantiation trap),
   tile/empty-state callbacks staying presenter-level (no feature imports in
   components), shared AI_CHAT_TITLE constant placement.
3. Assistant page: current shape of src/features/ai-assistant/ (page, store,
   controller) — is the empty-state + refresh plan executable as written?
4. Write-set completeness (all files the worker will touch) and AC pinning.
5. Anything missing for the operator's ask (no explicit way to create an AI
   chat today) or wrongly scoped.

Return READY_TO_FREEZE / BLOCKED with findings. Budget: 2 rounds.
