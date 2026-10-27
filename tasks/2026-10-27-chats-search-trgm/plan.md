# Plan — 2026-10-27-chats-search-trgm

Harden `/chats/search` with pg_trgm functional GIN indexes. The LIKE scan
(`lower(title)`, `lower(content)`, escaped `%q%`) keeps its exact semantics;
migration 008 gives PostgreSQL a trigram index over exactly those expressions.
Base: `dev` @ 5db03ac (PR #42 merged).

## Why pg_trgm and not FTS

tsvector/FTS would change the contract: morphology/prefix matching instead of
raw substring means a matched row may not contain the query string at all —
breaking the frontend's first-occurrence `<mark>` highlight and the pinned
snippet semantics. pg_trgm accelerates `LIKE '%q%'` on exactly the existing
expressions with zero behavioural change.

## Wave 1 — backend (WS-BE-TRGM)

1. `backend/alembic/versions/008_pg_trgm_search_indexes.py` —
   `down_revision = '007_avatars_stories'`; upgrade:
   `CREATE EXTENSION IF NOT EXISTS pg_trgm`, then
   `ix_chats_title_trgm` over `lower(title) gin_trgm_ops` and
   `ix_messages_content_trgm` over `lower(content) gin_trgm_ops`;
   downgrade: drop the two indexes (extension stays — shared object,
   documented). PG-only is the accepted 005 precedent (tests never run
   alembic; verify:backend checks pytest + heads).
2. Scratch-PG evidence (own compose project + volumes + 127.0.0.2 bind,
   the 007 round-trip runbook):
   - upgrade 001→008 on a clean base; `\d`/pg_indexes show both indexes over
     exactly `lower(title)`/`lower(content)`;
   - downgrade → indexes gone, heads 007; upgrade again (idempotent);
   - seed ≥1000 messages across ≥30 chats (searching user a member of all
     chats; a selective needle), then prove index usability in two layers:
     per-table standalone `EXPLAIN SELECT … WHERE lower(col) LIKE '%needle%'`
     (Bitmap/Index Scan over the trgm index) and the full repository query
     shape with transcripts — trgm path demonstrated via forcing GUCs
     (`enable_seqscan=off`, plus `enable_indexscan=off`/`enable_nestedloop=off`
     if the planner legitimately prefers PK/nested-loop paths at small
     corpora; forcing labelled in the transcript); default-planner
     transcripts recorded either way;
   - outputs captured under `work/2026-10-27-chats-search-trgm/evidence/`.
3. Gates: `PYTHON_BIN=~/.venvs/chatty-backend/bin/python npm run verify:backend`
   green (pytest untouched-green + `alembic heads` =
   `008_pg_trgm_search_indexes`).
4. Docs: `docs/NEXT.md` — retire the FTS/pg_trgm deferral note (FTS/tsvector
   stays a deliberate non-goal, reason stated);
   `docs/progress/progress_log.md` — entry on top.

## Out of scope

FTS/tsvector, relevance ranking, trigram similarity thresholds/ordering, GIN
maintenance tuning, applying to the operator's live stack (post-merge operator
step), any frontend or endpoint-contract change, GET /chats / last_message.

## Evidence

`EV-BE-1` = verify:backend output + scratch-PG round-trip and EXPLAIN
transcripts under `work/2026-10-27-chats-search-trgm/evidence/`.
