"""Vacation skill settings read from the environment.

`app/core/config.py` stays untouched: the vacation knobs are owned by
this package and documented in `backend/.env.example`
(the app/bot/config.py precedent).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DATA_DIR = 'CHATTY_VACATION_DATA_DIR'
FILE_GLOB = 'CHATTY_VACATION_FILE_GLOB'
DIALOG_TTL_SECONDS = 'CHATTY_VACATION_DIALOG_TTL_SECONDS'
ORG_NAME = 'CHATTY_VACATION_ORG_NAME'
ADDRESSEE_NAME = 'CHATTY_VACATION_ADDRESSEE_NAME'

# backend/data resolved from this file, never from the cwd: the ingest
# CLI and the API may run from different working directories
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / 'data'
DEFAULT_FILE_GLOB = 'график отпусков*.xlsx'
# A stale «да» must not bind to a new topic (D-5)
DEFAULT_DIALOG_TTL_SECONDS = 600.0


@dataclass(frozen=True)
class VacationSettings:
    data_dir: Path
    file_glob: str
    dialog_ttl_seconds: float
    # The application-form header requisites (D-F-1/D-F-10): real values
    # live ONLY in the operator env — never in the repo or the templates;
    # empty values make the forms wizards refuse with a runbook pointer.
    org_name: str = ''
    addressee_name: str = ''


def vacation_settings_from_env(environ: dict[str, str] | None = None) -> VacationSettings:
    env = os.environ if environ is None else environ
    raw_dir = env.get(DATA_DIR, '').strip()
    try:
        ttl = float(env.get(DIALOG_TTL_SECONDS, DEFAULT_DIALOG_TTL_SECONDS))
    except ValueError:
        ttl = DEFAULT_DIALOG_TTL_SECONDS
    return VacationSettings(
        data_dir=Path(raw_dir) if raw_dir else DEFAULT_DATA_DIR,
        file_glob=env.get(FILE_GLOB, DEFAULT_FILE_GLOB).strip() or DEFAULT_FILE_GLOB,
        dialog_ttl_seconds=ttl if ttl > 0 else DEFAULT_DIALOG_TTL_SECONDS,
        org_name=env.get(ORG_NAME, '').strip(),
        addressee_name=env.get(ADDRESSEE_NAME, '').strip(),
    )
