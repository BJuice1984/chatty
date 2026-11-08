"""VacationStore surname and dialog-state pins (TTL, upsert, delete)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import AssistantDialogState, User
from app.vacations.store import VacationStore


@pytest.fixture()
def session():
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as active:
        active.add(
            User(
                email='user@example.test',
                password_hash='x',
                role='user',
                is_active=True,
                token_version=0,
            )
        )
        active.commit()
        yield active
    engine.dispose()


@pytest.fixture()
def user_id(session: Session) -> int:
    return session.query(User.id).filter(User.email == 'user@example.test').one()[0]


@pytest.fixture()
def store(session: Session) -> VacationStore:
    return VacationStore(session)


def test_surname_upsert_and_delete(store: VacationStore, session: Session, user_id: int) -> None:
    assert store.get_surname(user_id) is None

    store.save_surname(user_id, 'Сибгатуллин И.Р.')
    session.commit()
    assert store.get_surname(user_id) == 'Сибгатуллин И.Р.'

    store.save_surname(user_id, 'Романов В.А.')
    session.commit()
    assert store.get_surname(user_id) == 'Романов В.А.'

    assert store.delete_surname(user_id) is True
    session.commit()
    assert store.get_surname(user_id) is None
    assert store.delete_surname(user_id) is False


def test_state_roundtrip_and_clear(store: VacationStore, session: Session, user_id: int) -> None:
    assert store.get_state(user_id) is None

    store.set_state(user_id, 'awaiting_yes', origin_content='Хочу в отпуск')
    session.commit()
    state = store.get_state(user_id)
    assert state is not None
    assert state.state == 'awaiting_yes'
    assert state.origin_content == 'Хочу в отпуск'
    assert state.attempts == 0

    store.bump_attempts(user_id)
    session.commit()
    assert store.get_state(user_id).attempts == 1

    store.clear_state(user_id)
    session.commit()
    assert store.get_state(user_id) is None


def test_expired_state_behaves_as_absent(store: VacationStore, session: Session, user_id: int) -> None:
    store.set_state(user_id, 'awaiting_yes', origin_content='отпуск?')
    session.commit()

    stale = datetime.now(UTC) - timedelta(seconds=3600)
    session.execute(
        update(AssistantDialogState)
        .where(AssistantDialogState.user_id == user_id)
        .values(updated_at=stale)
    )
    session.commit()
    assert store.get_state(user_id) is None

    fresh = datetime.now(UTC) - timedelta(seconds=30)
    session.execute(
        update(AssistantDialogState)
        .where(AssistantDialogState.user_id == user_id)
        .values(updated_at=fresh)
    )
    session.commit()
    assert store.get_state(user_id) is not None
