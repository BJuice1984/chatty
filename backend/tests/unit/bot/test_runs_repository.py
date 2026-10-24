"""Bot run repository: idempotency key and conditional claim transitions."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.bot_run import BotRun
from app.repositories.bot_runs import BotRunRepository


@pytest.fixture()
def session():
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


def add_run(session: Session, *, message_id: int = 1, status: str = 'queued', attempt: int = 0) -> BotRun:
    run = BotRun(chat_id=1, message_id=message_id, status=status, attempt=attempt)
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def test_get_by_message_id_finds_the_single_run(session):
    add_run(session, message_id=7)

    repository = BotRunRepository(session)
    assert repository.get_by_message_id(7) is not None
    assert repository.get_by_message_id(8) is None


def test_duplicate_message_id_is_rejected(session):
    add_run(session, message_id=7)

    with pytest.raises(IntegrityError):
        add_run(session, message_id=7)


def test_claim_fresh_transitions_queued_to_running_once(session):
    run = add_run(session, status='queued', attempt=0)
    repository = BotRunRepository(session)

    assert repository.claim_fresh(run, now=datetime.now(UTC)) is True
    session.refresh(run)
    assert run.status == 'running'
    assert run.attempt == 1

    assert repository.claim_fresh(run, now=datetime.now(UTC)) is False
    session.refresh(run)
    assert run.attempt == 1


def test_claim_fresh_refuses_failed_and_succeeded_rows(session):
    repository = BotRunRepository(session)
    failed = add_run(session, status='failed', attempt=1)
    succeeded = add_run(session, message_id=2, status='succeeded', attempt=1)

    assert repository.claim_fresh(failed, now=datetime.now(UTC)) is False
    assert repository.claim_fresh(succeeded, now=datetime.now(UTC)) is False


def test_reclaim_stale_requires_attempt_unchanged(session):
    run = add_run(session, status='running', attempt=1)
    repository = BotRunRepository(session)


    assert repository.reclaim_stale(run, now=datetime.now(UTC)) is True
    session.refresh(run)
    assert run.status == 'running'
    assert run.attempt == 2

    # a detached view still holding attempt=1 while the row already moved to 2:
    # the compare-and-set must lose instead of double-claiming
    stale_view = BotRun(id=run.id, chat_id=run.chat_id, message_id=run.message_id, status='running', attempt=1)
    assert repository.reclaim_stale(stale_view, now=datetime.now(UTC)) is False
    session.refresh(run)
    assert run.attempt == 2


def test_reclaim_stale_refuses_succeeded_rows(session):
    run = add_run(session, status='succeeded', attempt=1)

    assert BotRunRepository(session).reclaim_stale(run, now=datetime.now(UTC)) is False


def test_retry_failed_transitions_within_attempt_guard(session):
    run = add_run(session, status='failed', attempt=1)
    repository = BotRunRepository(session)

    assert repository.retry_failed(run, now=datetime.now(UTC)) is True
    session.refresh(run)
    assert run.status == 'running'
    assert run.attempt == 2

    assert repository.retry_failed(run, now=datetime.now(UTC)) is False


def test_retry_failed_refuses_non_failed_rows(session):
    run = add_run(session, status='queued', attempt=0)

    assert BotRunRepository(session).retry_failed(run, now=datetime.now(UTC)) is False


def test_all_runs_are_queryable_by_chat(session):
    add_run(session, message_id=1)
    add_run(session, message_id=2)

    runs = list(session.scalars(select(BotRun).where(BotRun.chat_id == 1)))
    assert len(runs) == 2
