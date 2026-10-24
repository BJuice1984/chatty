from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.db.base import Base
from app.models.file import File
from app.models.story import Story
from app.models.user import User
from app.seed import seed_demo_stories


class MemoryStorage:
    def __init__(self):
        self.uploads: list[str] = []

    def upload(self, object_key: str, body: bytes, content_type: str) -> None:
        assert content_type == 'image/jpeg'
        self.uploads.append(object_key)

    def download(self, object_key: str):
        raise AssertionError('seed never downloads')


@pytest.fixture()
def session() -> Session:
    engine = create_engine(
        'sqlite://',
        connect_args={'check_same_thread': False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    Base.metadata.drop_all(engine)
    engine.dispose()


def settings_with(stories: bool) -> Settings:
    return Settings(
        environment='test',
        database_url='sqlite://',
        jwt_secret='test-secret-that-is-long-enough-for-jwt-signing',
        seed_demo_stories=stories,
    )


def test_demo_stories_seed_creates_users_files_and_stories(session: Session):
    storage = MemoryStorage()

    assert seed_demo_stories(session, settings_with(True), storage) is True

    emails = sorted(user.email for user in session.scalars(select(User)))
    assert emails == ['athalia@chatty.demo', 'erlan@chatty.demo', 'midala@chatty.demo']

    files = list(session.scalars(select(File)))
    assert sorted(file.object_key for file in files) == [
        'media/seed-athalia',
        'media/seed-erlan',
        'media/seed-midala',
    ]
    assert all(file.chat_id is None and file.status == 'ready' for file in files)

    stories = list(session.scalars(select(Story)))
    assert len(stories) == 3
    # порядок свежести: midala новее всех — она первая в ленте
    by_owner = {story.owner_id: story for story in stories}
    midala = session.scalar(select(User).where(User.email == 'midala@chatty.demo'))
    others = [story for story in stories if story.owner_id != midala.id]
    assert all(by_owner[midala.id].created_at >= story.created_at for story in others)
    assert len(storage.uploads) == 3


def test_demo_stories_seed_is_idempotent_and_refreshes_ttl(session: Session):
    storage = MemoryStorage()

    seed_demo_stories(session, settings_with(True), storage)
    first = {story.id: story.created_at for story in session.scalars(select(Story))}

    # «прошло время»: сдвигаем created_at в прошлое, seed обязан освежить
    stale = datetime.now(UTC).replace(year=2020)
    for story in session.scalars(select(Story)):
        story.created_at = stale
    session.commit()

    assert seed_demo_stories(session, settings_with(True), storage) is False
    assert len(list(session.scalars(select(User)))) == 3
    assert len(list(session.scalars(select(File)))) == 3
    assert len(list(session.scalars(select(Story)))) == 3
    # повторной загрузки файлов не было, created_at освежены
    assert len(storage.uploads) == 3
    refreshed = {story.id: story.created_at for story in session.scalars(select(Story))}
    assert all(refreshed[story_id] > created for story_id, created in first.items())


def test_demo_stories_seed_disabled_by_settings(session: Session):
    storage = MemoryStorage()

    assert seed_demo_stories(session, settings_with(False), storage) is False
    assert storage.uploads == []
    assert list(session.scalars(select(Story))) == []


def test_demo_stories_seed_requires_storage(session: Session):
    assert seed_demo_stories(session, settings_with(True), None) is False
    assert list(session.scalars(select(User))) == []
