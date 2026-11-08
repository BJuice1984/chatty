"""Surname and dialog-state persistence for the vacation skill.

Runs are stateless (keyed by message_id) and API restarts lose memory,
so both the confirmed surname and the pending dialog state live in the
database (D-5). The state is keyed by user_id only — the flow is
personal and the surname question must not repeat in another chat.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import AssistantDialogState, VacationName
from app.vacations.config import vacation_settings_from_env


@dataclass(frozen=True)
class DialogState:
    state: str
    origin_content: str | None
    attempts: int
    # JSON blob for the forms wizards (D-F-11: chosen form kind, period
    # and the collected dates); None for the parent skill's simple states.
    payload: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


class VacationStore:
    def __init__(self, session: Session) -> None:
        self._session = session

    # --- confirmed surname -------------------------------------------------

    def get_surname(self, user_id: int) -> str | None:
        row = self._session.get(VacationName, user_id)
        return row.schedule_name if row is not None else None

    def save_surname(self, user_id: int, schedule_name: str) -> None:
        row = self._session.get(VacationName, user_id)
        if row is None:
            self._session.add(VacationName(user_id=user_id, schedule_name=schedule_name, confirmed_at=_now()))
        else:
            row.schedule_name = schedule_name
            row.confirmed_at = _now()
        self._session.flush()

    def delete_surname(self, user_id: int) -> bool:
        deleted = self._session.execute(
            delete(VacationName).where(VacationName.user_id == user_id)
        ).rowcount
        self._session.flush()
        return bool(deleted)

    # --- dialog state -------------------------------------------------------

    def get_state(self, user_id: int) -> DialogState | None:
        """None when absent or older than the TTL (a stale «да» binds nothing)."""

        row = self._session.get(AssistantDialogState, user_id)
        if row is None:
            return None
        updated = row.updated_at
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=UTC)
        ttl = vacation_settings_from_env().dialog_ttl_seconds
        if updated + timedelta(seconds=ttl) < _now():
            return None
        return DialogState(
            state=row.state,
            origin_content=row.origin_content,
            attempts=row.attempts,
            payload=row.payload,
        )

    def set_state(
        self,
        user_id: int,
        state: str,
        origin_content: str | None = None,
        attempts: int = 0,
        payload: str | None = None,
    ) -> None:
        row = self._session.get(AssistantDialogState, user_id)
        if row is None:
            self._session.add(
                AssistantDialogState(
                    user_id=user_id,
                    state=state,
                    origin_content=origin_content,
                    attempts=attempts,
                    payload=payload,
                    updated_at=_now(),
                )
            )
        else:
            row.state = state
            row.origin_content = origin_content
            row.attempts = attempts
            row.payload = payload
            row.updated_at = _now()
        self._session.flush()

    def bump_attempts(self, user_id: int) -> None:
        row = self._session.get(AssistantDialogState, user_id)
        if row is None:
            return
        row.attempts += 1
        row.updated_at = _now()
        self._session.flush()

    def clear_state(self, user_id: int) -> None:
        self._session.execute(
            delete(AssistantDialogState).where(AssistantDialogState.user_id == user_id)
        )
        self._session.flush()
