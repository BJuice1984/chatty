# Developer overview — 2026-10-27-chats-search-trgm

One workstream: WS-BE-TRGM (alembic + scratch-PostgreSQL evidence + docs).
Base dev@5db03ac; branch `feature/2026-10-27-chats-search-trgm`.

The search queries this run accelerates live in
`backend/app/repositories/chats.py` (`search_title_matches`,
`search_message_matches`): membership-scoped joins filtering
`lower(Chat.title).like(escaped, escape='\\')` and
`lower(Message.content).like(escaped, escape='\\')` with
`content IS NOT NULL`. A PostgreSQL **functional GIN index** over exactly
`lower(col) gin_trgm_ops` lets the planner answer `LIKE '%q%'` with a trigram
bitmap scan — the expressions must match the query expressions verbatim,
which is why the indexes are functional and not plain column indexes.

Migration shape (007 pattern, numbered chain, revision id = slug):
`008_pg_trgm_search_indexes`, `down_revision = '007_avatars_stories'`.
`CREATE EXTENSION IF NOT EXISTS pg_trgm` works for the DB owner (trusted
extension; the compose `POSTGRES_USER` owns the database; the official
postgres image ships contrib). PG-only is the accepted 005 precedent —
pytest fixtures build the schema with `create_all` and never run alembic;
`verify:backend` asserts pytest + `alembic heads` only.

Scratch-stack evidence (do NOT touch the operator stack): separate compose
project name + volumes + a 127.0.0.2 bind, the migration-007 round-trip
runbook (`docs/progress/progress_log.md` 2026-10-22). Seed a non-trivial
corpus (≥1000 messages, ≥30 chats, searching user member of all chats,
selective needle) before EXPLAIN. Planner honesty: on tiny tables or narrow
membership the planner legitimately prefers a seqscan or a nested-loop over
`ix_messages_chat_created_id` PK lookups — and `enable_seqscan=off` removes
only seqscan paths, not those competitors. Prove index usability with the
per-table standalone EXPLAIN (the index answers the exact filtered
expression) plus full-query transcripts with explicitly-labelled forcing
GUCs (`enable_indexscan=off`/`enable_nestedloop=off` when needed) — never
dictate the default plan.

Risks: extension privileges (owner — fine in compose; on managed PG without
CREATE privileges the migration would fail — document as a deployment note,
out of scope); functional-index/query drift if a future query edit changes
the filtered expression (coupling documented in the migration-008 docstring
and the progress-log entry; a repositories/chats.py comment is outside this
run's write-set and deferred); GIN trigram write-amplification on the
messages insert path (every message send now maintains the index;
fastupdate=on amortizes via the pending list by default — tuning stays a
non-goal; the tradeoff is stated in the progress-log entry).

Execution model: single worker, one attempt budgeted at 3; evidence
`EV-BE-1` (verify:backend + scratch transcripts); PR to `dev` after the run.
