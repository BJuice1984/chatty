# Acceptance criteria

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-LIVE-1` | `REQ-LIVE-FIXES` | `EV-LIVE-1` | Live-run findings (LIVE-2…LIVE-7, HD-R3, status-hold UX) are fixed in the reviewed delta with semantics as exercised live, and every finding carries one deterministic regression test; `npm run verify` is green. |
| `AC-LIVE-2` | `REQ-LIVE-FIXES` | `EV-LIVE-2` | After an internal transport reconnect the own adapter re-requests the initial history page and the merged list has no duplicates; covered by a `ws.test.ts` regression test with a mocked second Connected event. |
| `AC-CUT-1` | `REQ-PRACTICUM-CUTOVER` | `EV-CUT-1` | `grep -ri 'practicum\|ya-praktikum\|Практикум'` returns zero matches across `src/`, `.github/`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/arch/` and the tracked root `.env*` example files (archives in `docs/progress/` and `tasks/`, plus `docs/project-principles.json` as governance history, exempt); the env mode fork, practicum adapters and mode-conditional validators are gone; validators are calibrated to the own contract (email, password ≥ 12); `npm run verify` is green. |
| `AC-CUT-2` | `REQ-PRACTICUM-CUTOVER` | `EV-CUT-2` | `npm run verify:all`, `docker compose config --quiet` and the strict architecture guard pass; the course bats workflow `.github/workflows/tests.yml` is deleted while `verify.yml`, `netlify.toml`, `backend/` and the principles digest stay untouched; README/AGENTS/CLAUDE and `docs/arch/*` describe own-only operation; ownership audit reports 0 unowned/forbidden. |
| `AC-CUT-3` | `REQ-PRACTICUM-CUTOVER` | `EV-CUT-2` | On the running local stack after cutover: login loads the chat list without a page reload, history load-more paginates without duplicates, a sent message echoes exactly once; the worker records the rows in the EV-CUT-2 artifact and the controller appends them to the lead-owned stage-11 checklist. |

## Evidence contract

`EV-LIVE-1` contains the `npm run verify` receipt with the new regression
suites (Store emit, validators, messenger send dispatch, chat-page fetch,
avatar null guard, ping content, HD-R3 timeout/hold). `EV-LIVE-2` contains
the HD-R2 `ws.test.ts` receipt. `EV-CUT-1` contains the grep gate plus
`verify:all`, Compose config and architecture-guard receipts. `EV-CUT-2`
contains the ownership audit, docs/CI diff review and the live re-smoke rows
(absent external dependencies — Ollama AI rows — stay explicit `UNAVAILABLE`).
No criterion is accepted from prose alone.
