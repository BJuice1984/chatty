"""Bot run persistence queries with conditional claim transitions."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.bot_run import BotRun


class BotRunRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, run_id: int) -> BotRun | None:
        return self.session.get(BotRun, run_id)

    def get_by_message_id(self, message_id: int) -> BotRun | None:
        statement = select(BotRun).where(BotRun.message_id == message_id)
        return self.session.scalars(statement).first()

    def add(self, run: BotRun) -> BotRun:
        self.session.add(run)
        self.session.flush()
        return run

    def claim_fresh(self, run: BotRun, *, now: datetime) -> bool:
        """Conditional ``queued -> running`` claim of a queued row."""
        return self._conditional_claim(run, statuses=('queued',), guard_attempt=False, now=now)

    def reclaim_stale(self, run: BotRun, *, now: datetime) -> bool:
        """Re-claim a stale ``queued/running`` row after a hard crash.

        The staleness itself is decided by the service (injectable clock,
        timezone-safe python comparison); the ``attempt`` equality guard is
        the compare-and-set that serializes concurrent re-claims.
        """
        return self._conditional_claim(run, statuses=('queued', 'running'), guard_attempt=True, now=now)

    def retry_failed(self, run: BotRun, *, now: datetime) -> bool:
        """Re-claim a ``failed`` row within the attempt budget."""
        return self._conditional_claim(run, statuses=('failed',), guard_attempt=True, now=now)

    def _conditional_claim(self, run: BotRun, *, statuses: tuple[str, ...], guard_attempt: bool, now: datetime) -> bool:
        predicates = [BotRun.id == run.id, BotRun.status.in_(statuses)]
        if guard_attempt:
            predicates.append(BotRun.attempt == run.attempt)
        statement = (
            update(BotRun)
            .where(*predicates)
            .values(status='running', attempt=run.attempt + 1, updated_at=now)
        )
        result = self.session.execute(statement)
        self.session.commit()
        return result.rowcount == 1
