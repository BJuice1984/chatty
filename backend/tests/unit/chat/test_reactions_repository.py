"""Reaction repository: ключ уникальности и агрегаты для сводок."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.chat import Chat, ChatMember
from app.models.message import Message
from app.models.reaction import Reaction
from app.models.user import User
from app.repositories.reactions import ReactionRepository


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


def seed_message(session: Session, *, email: str, chat_title: str = 'Chat') -> Message:
    user = User(email=email, password_hash='hash')
    session.add(user)
    session.flush()
    chat = Chat(title=chat_title, owner_id=user.id)
    session.add(chat)
    session.flush()
    session.add(ChatMember(chat_id=chat.id, user_id=user.id))
    message = Message(chat_id=chat.id, user_id=user.id, content='text')
    session.add(message)
    session.commit()
    session.refresh(message)
    return message


def test_find_add_and_remove_toggle_the_same_key(session):
    message = seed_message(session, email='author@example.com')

    repository = ReactionRepository(session)
    assert repository.find(message.id, message.user_id, '👍') is None

    repository.add(Reaction(message_id=message.id, user_id=message.user_id, emoji='👍'))
    assert repository.find(message.id, message.user_id, '👍') is not None

    repository.remove(repository.find(message.id, message.user_id, '👍'))
    assert repository.find(message.id, message.user_id, '👍') is None


def test_duplicate_message_user_emoji_is_rejected(session):
    message = seed_message(session, email='author@example.com')

    repository = ReactionRepository(session)
    repository.add(Reaction(message_id=message.id, user_id=message.user_id, emoji='❤️'))
    session.commit()

    with pytest.raises(IntegrityError):
        session.add(Reaction(message_id=message.id, user_id=message.user_id, emoji='❤️'))
        session.commit()


def test_same_user_other_emoji_and_other_user_same_emoji_are_allowed(session):
    first = seed_message(session, email='author@example.com')
    other = User(email='reader@example.com', password_hash='hash')
    session.add(other)
    session.commit()
    session.refresh(other)

    repository = ReactionRepository(session)
    session.add_all(
        [
            # тот же пользователь, другой эмодзи
            Reaction(message_id=first.id, user_id=first.user_id, emoji='👍'),
            Reaction(message_id=first.id, user_id=first.user_id, emoji='❤️'),
            # другой пользователь, тот же эмодзи
            Reaction(message_id=first.id, user_id=other.id, emoji='👍'),
        ]
    )
    session.commit()

    assert repository.find(first.id, first.user_id, '👍') is not None
    assert repository.find(first.id, first.user_id, '❤️') is not None
    assert repository.find(first.id, other.id, '👍') is not None


def test_counts_by_message_groups_per_emoji_and_orders_stably(session):
    first = seed_message(session, email='author@example.com')
    second = seed_message(session, email='peer@example.com')
    author = User(email='onlooker@example.com', password_hash='hash')
    session.add(author)
    session.commit()
    session.refresh(author)

    session.add_all(
        [
            Reaction(message_id=first.id, user_id=first.user_id, emoji='👍'),
            Reaction(message_id=first.id, user_id=second.user_id, emoji='👍'),
            Reaction(message_id=first.id, user_id=author.id, emoji='❤️'),
            Reaction(message_id=second.id, user_id=first.user_id, emoji='😢'),
        ]
    )
    session.commit()

    counts = ReactionRepository(session).counts_by_message([first.id, second.id])

    assert counts == [
        (first.id, '❤️', 1),
        (first.id, '👍', 2),
        (second.id, '😢', 1),
    ]


def test_aggregates_handle_empty_input_without_queries(session):
    repository = ReactionRepository(session)

    assert repository.counts_by_message([]) == []
    assert repository.viewer_emojis([], viewer_id=1) == set()


def test_viewer_emojis_returns_only_own_pairs(session):
    message = seed_message(session, email='author@example.com')
    viewer = User(email='viewer@example.com', password_hash='hash')
    session.add(viewer)
    session.commit()
    session.refresh(viewer)

    session.add_all(
        [
            Reaction(message_id=message.id, user_id=viewer.id, emoji='👍'),
            Reaction(message_id=message.id, user_id=message.user_id, emoji='❤️'),
        ]
    )
    session.commit()

    repository = ReactionRepository(session)

    assert repository.viewer_emojis([message.id], viewer_id=viewer.id) == {(message.id, '👍')}
    assert repository.viewer_emojis([message.id], viewer_id=message.user_id) == {(message.id, '❤️')}
    assert repository.viewer_emojis([message.id], viewer_id=999) == set()
