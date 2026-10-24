# Stage 11 — Hardening, history and documentation

Roadmap alias: `hardening-docs`; ALK package id: `2026-09-28-hardening-docs`. Create `feature/2026-09-28-hardening-docs` from accepted `dev@99c5502b59158426693da076982daa81ab9df84e` after stages 7, 9 and 10 (PR #23); the r1 draft was authored on `feature/agent-harness` against `main`, r2 rebases it onto the accepted AI contour and widens the write-set by explicit user decision.

Harden the shared WebSocket transport with reconnect/backoff and deterministic close cleanup, add chat history pagination in the UI over the `before_id`/limit contract, close the stage 10 carry-forward debt (NEW-1, NEW-2/NEW-3, RV5/RV6) and the `Block.destroy` `__children` leak, and document the local owned-backend runbook, release boundary and progress. Preserve the agent harness, architecture guard, course CI, Netlify configuration and principles authority. This is the final stage and owns the final implementation/audit evidence boundary; it does not claim production promotion.

The reconnect/history browser checklist is required. A live backend/Ollama/MinIO absence is `UNAVAILABLE`, while deterministic frontend and documentation checks still run.

Write-set notes for reviewers: edits inside `src/features/chats` (ports/ws) and `src/components/messenger` are strictly additive composition points (precedent: stages 4/10); `src/core/Block.ts` changes are limited to destroy-time child cleanup plus the minimal compile-time capture of the `__children` list; `src/features/ai-assistant` entries carry exactly the reviewed carry-forward fixes with one regression test each.
