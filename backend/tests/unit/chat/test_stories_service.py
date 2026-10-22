from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.db.base import Base
from app.models.file import File
from app.models.story import Story, StoryView
from app.models.user import User
from app.services.stories import StoryService


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


def make_user(session: Session, email: str) -> User:
    user = User(email=email, password_hash='x' * 60)
    session.add(user)
    session.flush()
    return user


def make_story(session: Session, owner: User, *, hours_ago: float = 0) -> Story:
    story = Story(
        owner_id=owner.id,
        file_id=make_file(session, owner).id,
        created_at=datetime.now(UTC) - timedelta(hours=hours_ago),
    )
    session.add(story)
    session.flush()
    return story


def make_file(session: Session, owner: User) -> File:
    file = File(
        chat_id=None,
        owner_id=owner.id,
        object_key=f'media/{owner.id}-{datetime.now(UTC).timestamp()}',
        original_name='s.png',
        content_type='image/png',
        size_bytes=1,
        status='ready',
    )
    session.add(file)
    session.flush()
    return file


def test_feed_orders_own_first_then_others_and_filters_ttl(session: Session):
    settings = Settings(environment='test', database_url='sqlite://', jwt_secret='test-secret-that-is-long-enough-for-jwt-signing')
    mine, other = make_user(session, 'mine@example.com'), make_user(session, 'other@example.com')

    old_other = make_story(session, other, hours_ago=2)
    newest_mine = make_story(session, mine, hours_ago=0)
    oldest_mine = make_story(session, mine, hours_ago=1)
    expired = make_story(session, other, hours_ago=25)

    feed = StoryService(session, settings).list_feed(mine.id)
    assert [item.id for item in feed] == [newest_mine.id, oldest_mine.id, old_other.id]

    # own-first, а не просто newest-first: чужая история свежее всех —
    # свои всё равно идут первыми (внутри групп прежний created_at desc)
    newer_other = make_story(session, other, hours_ago=0.5)

    feed = StoryService(session, settings).list_feed(mine.id)
    assert [item.id for item in feed] == [newest_mine.id, oldest_mine.id, newer_other.id, old_other.id]
    assert all(item.viewed is False for item in feed)
    assert expired.id not in {item.id for item in feed}


def test_feed_resolves_viewed_per_caller(session: Session):
    settings = Settings(environment='test', database_url='sqlite://', jwt_secret='test-secret-that-is-long-enough-for-jwt-signing')
    mine, viewer = make_user(session, 'mine@example.com'), make_user(session, 'viewer@example.com')
    story = make_story(session, mine)
    session.add(StoryView(story_id=story.id, user_id=viewer.id))
    session.flush()

    service = StoryService(session, settings)
    assert service.list_feed(viewer.id)[0].viewed is True
    assert service.list_feed(mine.id)[0].viewed is False

    service.mark_viewed(story.id, mine.id)
    service.mark_viewed(story.id, mine.id)
    assert session.query(StoryView).filter_by(user_id=mine.id).count() == 1


def test_feed_owner_fields(session: Session):
    settings = Settings(environment='test', database_url='sqlite://', jwt_secret='test-secret-that-is-long-enough-for-jwt-signing')
    mine = make_user(session, 'mine@example.com')
    story = make_story(session, mine)

    item = StoryService(session, settings).list_feed(mine.id)[0]
    assert item.owner_display_name == 'mine'
    assert item.owner_avatar_url is None
    assert item.image_url == f'{story.file_id}/download'

    avatar = make_file(session, mine)
    mine.avatar_file_id = avatar.id
    session.flush()
    item = StoryService(session, settings).list_feed(mine.id)[0]
    assert item.owner_avatar_url == f'{avatar.id}/download'
