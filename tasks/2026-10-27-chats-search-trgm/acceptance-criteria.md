# Acceptance criteria — 2026-10-27-chats-search-trgm

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-TRGM-INDEXES` | `REQ-BE-TRGM` | `EV-BE-1` | Migration `008_pg_trgm_search_indexes` (down_revision `007_avatars_stories`) creates the pg_trgm extension (`IF NOT EXISTS`) and functional GIN indexes `ix_chats_title_trgm` over `lower(title) gin_trgm_ops` and `ix_messages_content_trgm` over `lower(content) gin_trgm_ops` — verbatim the expressions the repository search queries filter; downgrade drops both indexes and keeps the extension (documented); scratch-PostgreSQL round-trip proven: clean 001→008 upgrade shows both indexes, downgrade → heads `007_avatars_stories` with indexes gone, re-upgrade idempotent; `npm run verify:backend` green with `alembic heads` = exactly `008_pg_trgm_search_indexes`; zero application-code changes (git diff touches only the migration + docs). |
| `AC-BE-SEARCH-PLAN` | `REQ-BE-SEARCH-PLAN` | `EV-BE-1` | On the scratch PostgreSQL with ≥1000 seeded messages across ≥30 chats, index usability is proven honestly in two layers: (1) per-table standalone `EXPLAIN SELECT … WHERE lower(content) LIKE '%needle%'` (and the title analogue) showing a Bitmap/Index Scan over `ix_messages_content_trgm` / `ix_chats_title_trgm`; (2) EXPLAIN of the full repository query shape (membership join + escaped LIKE) with transcripts recorded — the trgm index path demonstrated, with forcing GUCs (`SET enable_seqscan=off`, and if the planner still prefers nested-loop/PK paths — legitimate and cheaper at small corpora — additionally `enable_indexscan=off`/`enable_nestedloop=off`, labelled as forcing in the transcript); default-planner transcripts recorded either way (seqscan or nested-loop on small corpora is legitimate planner behaviour — noted, not failure); transcripts captured under `work/2026-10-27-chats-search-trgm/evidence/`. |
| `AC-PROCESS` | `REQ-BE-TRGM`, `REQ-BE-SEARCH-PLAN`, `REQ-DOCS-TRGM` | `EV-BE-1` | `npm run verify` (frontend untouched but the gate must stay green) and `npm run verify:backend` pass; `guard-architecture --all --strict` zero violations; `docs/NEXT.md` retires the FTS/pg_trgm deferral note keeping FTS/tsvector a stated non-goal; `docs/progress/progress_log.md` gets an entry on top; no file outside the manifest write-sets changes; the operator's live compose stack is untouched (scratch project only). |

## Details

### AC-BE-TRGM-INDEXES — functional expressions are load-bearing

PostgreSQL serves `lower(col) LIKE '%q%'` from an index only when the index
is built over the same expression `lower(col)` — a plain `gin_trgm_ops`
index over the raw column would not match the filtered expression. The
migration therefore creates functional indexes. The query↔index coupling is
documented in the migration-008 docstring and the progress-log entry; a
matching comment in `repositories/chats.py` is outside this run's write-set
(backend/app is forbidden) and stays deferred to a future code-touching task.

### AC-BE-SEARCH-PLAN — honest planner expectations

pg_trgm bitmap scans beat alternatives only on non-trivial corpora and
selective needles; on tiny tables, ultra-short needles or narrow membership
the planner legitimately picks a seqscan or a nested-loop over
`ix_messages_chat_created_id` PK lookups — and `enable_seqscan=off` removes
only seqscan paths, not those competitors. The acceptance therefore pins
index USABILITY (the standalone per-table EXPLAIN proves the index answers
the exact filtered expression) plus recorded full-query transcripts with
explicitly-labelled forcing GUCs — never a specific default plan.

### AC-PROCESS — gates and bookkeeping

`EV-BE-1` is the verify:backend output plus the scratch-PG round-trip and
EXPLAIN transcripts. Applying the migration to the operator's live stack
(`docker compose --env-file .env up -d --build api` + observing 008 apply)
is a post-merge operator step, explicitly not part of this run.
