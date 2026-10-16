# Reconnect and history evidence checklist

Record source revision, plan digest, browser, chat id, command/manual steps and result.

| Case | Required observation | Result |
| --- | --- | --- |
| HARDEN-DISCONNECT | Disconnect is visible and no stale listener remains. | PASS / FAIL / UNAVAILABLE |
| HARDEN-RECONNECT | Backoff reconnects once per attempt and does not duplicate subscriptions/messages. | PASS / FAIL / UNAVAILABLE |
| HARDEN-CLOSE | Explicit close prevents reconnect and removes handlers. Deterministic carrier: the close-cleanup regression test in `src/utils/WSTransport.test.ts`; the browser row is recorded additionally when a live backend exists. | PASS / FAIL (deterministic carrier) |
| HARDEN-HISTORY | Scroll/load-more uses `before_id`/limit and preserves order without duplicates. | PASS / FAIL / UNAVAILABLE |
| HARDEN-ERROR | Transport/history error is recoverable and text-only. | PASS / FAIL / UNAVAILABLE |

## Live run 2026-10-15/16 — all rows PASS (LIVE-1 closed)

| Field | Value |
| --- | --- |
| Source revision | `dev@d72a4ce` + live-fixes working tree (see `2026-10-16-practicum-cutover` package) |
| Plan digest | `82a0d67209b184f2863a723bbf8e306f1785d034ff466043315c38630a248d7a` |
| Browser | Chrome headless (playwright-core, `/usr/bin/google-chrome-stable`) + operator manual checks |
| Chat id | 9 («harden-manual-smoke-2», 60 seeded messages, user `manual.smoke2@example.com`) |
| Stack | docker compose (api/db/rustfs), operator env `~/.config/chatty/own-backend.env`; Ollama absent — AI rows out of scope here |

Results:

- **HARDEN-DISCONNECT — PASS.** `docker compose restart api` (~14 s outage): socket closed (1006), page alive, no stale listeners; reconnect attempts visible in the WS panel (1→2→4→8→15 s).
- **HARDEN-RECONNECT — PASS.** Both open tabs reconnected after the outage; sent message echoed exactly once (DOM count 1, DB row 154) — no duplicate subscriptions.
- **HARDEN-CLOSE — PASS.** Deterministic carrier: `src/utils/WSTransport.test.ts` close-cleanup suite (172 tests green); live row recorded per this run.
- **HARDEN-HISTORY — PASS.** Primary page 50 (desc, `next_before_id=min(id)`), «загрузить ещё» prepends 01–10 without duplicates, cursor exhausted; WS-contract carrier `work/2026-09-28-hardening-docs/live-smoke/ws-history-smoke.mjs` — 30/30 checks.
- **HARDEN-ERROR — PASS.** Connection-refused errors surfaced as text (console), page never crashed; HD-R3 recovery path verified: lost WS answer turns into a text error with a retry button after the 10 s timeout.

Note. The live run surfaced findings LIVE-2…LIVE-7 (own-mode login validation, SPA chat list refresh, avatar null rendering, Store.set emit suppression for nested slices, messenger send callbacks, ping content contract) — fixes live in the working tree and are carried into the `2026-10-16-practicum-cutover` package with regression coverage. See `docs/progress/progress_log.md` for the run summary.
