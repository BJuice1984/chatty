# Independent plan review request (round 2, revision 3)

Focused re-audit after the round-1 `CHANGES_REQUIRED`. Verify read-only that
each round-1 finding is closed **in the plan text** and that nothing else
regressed; the rest of the package was verified sound in round 1 and only
needs a spot check.

Round-1 findings and their closures:

1. **[MEDIUM] Source-message validation** — now specified: existence
   (`message_not_found`), route-chat ownership (`message_not_in_chat`),
   text-content requirement (`message_content_required`) and the
   bot-own-message guard (`bot_own_message`), with a cross-chat integration
   test in `plan.md` step 4 and `compatibility.sourceMessage` in the
   manifest.
2. **[MEDIUM] Duplicate delivery vs crash resume** — now disambiguated:
   conditional queued→running CAS claim; concurrent first delivery via the
   unique-key IntegrityError path; duplicates on fresh/running/succeeded rows
   never re-execute; stale `queued`/`running` rows older than
   `CHATTY_BOT_STALE_AFTER_SECONDS` (injectable clock) re-claim with
   `attempt++`; exhausted budget = explicit 409
   (`developer-overview.md` «Stale-run recovery», `compatibility.retries`).
3. **[LOW] Bot-user bootstrap** — operator registers the configured account
   through the public auth API; `bot_user_not_configured` is the accepted
   steady state; no seed edits (`compatibility.botIdentity`).
4. **[LOW] FK on-delete pins** — `message_id` CASCADE, `bot_user_id`
   RESTRICT, `response_message_id`/`attachment_file_id` SET NULL
   (`compatibility.runForeignKeys`, «Migration» in the overview).
5. **[LOW] forbiddenWrites** — `backend/app/schemas/message.py`,
   `backend/tests/conftest.py`, `backend/alembic/env.py`, `backend/verify.sh`
   added.

Return `PASS`, `CHANGES_REQUIRED` or `BLOCKED` with exact paths and findings.
