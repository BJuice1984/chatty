from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.models.user import User
from app.schemas.chat import ChatCreate
from app.schemas.message import MessageCreate
from app.services.chats import ChatService
from app.services.messages import MessageService


def create_user(session, email: str) -> User:
    user = User(email=email, password_hash=hash_password('correct horse battery staple'))
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_message_idempotency_and_bounded_history(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        chat = ChatService(session).create(owner.id, ChatCreate(title='Support'))
        service = MessageService(session)

        first = service.create(chat.id, owner.id, MessageCreate(content='first', client_message_id='client-1'))
        duplicate = service.create(chat.id, owner.id, MessageCreate(content='changed', client_message_id='client-1'))
        service.create(chat.id, owner.id, MessageCreate(content='second', client_message_id='client-2'))
        service.create(chat.id, owner.id, MessageCreate(content='third', client_message_id='client-3'))

        assert duplicate.id == first.id
        assert duplicate.content == 'first'

        page, next_before_id = service.history(chat.id, owner.id, before_id=None, limit=2)
        assert [message.content for message in page] == ['third', 'second']
        assert next_before_id is not None

        older, older_cursor = service.history(chat.id, owner.id, before_id=next_before_id, limit=2)
        assert [message.content for message in older] == ['first']
        assert older_cursor is None


def test_message_operations_require_membership(session_factory):
    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        outsider = create_user(session, 'outsider@example.com')
        chat = ChatService(session).create(owner.id, ChatCreate(title='Private'))

        with pytest.raises(HTTPException) as error:
            MessageService(session).create(chat.id, outsider.id, MessageCreate(content='nope'))

        assert error.value.status_code == 403
