# Vacation schedule updates (operator runbook)

How to load and refresh the corporate vacation schedule
(`график отпусков <год>.xlsx`) used by the messenger AI assistant's
vacation skill. The real file contains employee names: it never enters
git — it lives in a gitignored data dir and is ingested into the
database by a CLI command. Local internal verification only; nothing
here is a production claim.

## Where the file lives

- Data dir: `backend/data/` (gitignored; created on demand). The
  default can be overridden with `CHATTY_VACATION_DATA_DIR`
  (`backend/.env.example`, `backend/app/vacations/config.py`).
- The file name must match the glob `график отпусков*.xlsx`
  (`CHATTY_VACATION_FILE_GLOB`); the four-digit year in the name fills
  truncated dates inside the workbook.

## How to ingest / update

Run from the repository root with the backend venv interpreter (the
stand path from the D-11 gate; the global `py -3.12` does NOT have the
backend dependencies):

```
<backend-venv-python> backend/scripts/ingest_vacations.py
```

With an explicit file and/or database URL (the operator env carries the
compose PostgreSQL credentials):

```
<backend-venv-python> backend/scripts/ingest_vacations.py --file backend/data/график\ отпусков\ 2026.xlsx --db postgresql+psycopg://chatty:<password>@localhost:5432/chatty
```

- Without `--file` the newest glob match in the data dir is used.
- `--db` overrides `CHATTY_DATABASE_URL` for host runs against the
  compose PostgreSQL; without it the script reads the app settings
  (run it from `backend/` or with the env set).
- The command prints a summary: year, dated row count, skipped rows
  (people without dates in the file — they are not stored and never
  appear in bot answers).

## Update semantics

- Same year + same file name: the old snapshot is REPLACED wholesale
  (re-running the command is idempotent — no duplicates).
- A new-year file (e.g. `график отпусков 2027.xlsx`) is added
  alongside; lookups answer from the LATEST snapshot only.
- Users' confirmed surnames live in their own table
  (`vacation_names`) and are never touched by a re-ingest.
- A person who vanished from the new snapshot: the bot notices on the
  next request (its stored name no longer resolves), deletes the
  stored surname, says the schedule was updated and asks once more.

## Verification

- Re-read the command summary (rows / skipped).
- One lookup check (scratch sqlite, no live stack needed):

```
<backend-venv-python> -c "import sys; sys.path.insert(0, 'backend'); from sqlalchemy import create_engine, select; from sqlalchemy.orm import Session; from app.models import VacationPeriod; e = create_engine('<db-url>'); print(Session(e).scalars(select(VacationPeriod.full_name, VacationPeriod.start_date, VacationPeriod.days).limit(5)).all())"
```

## Rollback

Re-run the ingest with the PREVIOUS file (keep the old xlsx in the
data dir under its own year/name); the snapshot for that year+name is
replaced back. The alembic downgrade for the whole feature is
`015_vacations` (see `backend/alembic/versions/`).
