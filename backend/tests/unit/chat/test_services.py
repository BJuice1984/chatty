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


def test_bot_answer_attachments_cross_chats_only_for_library_documents(session_factory):
    """Live-инцидент 2026-11-06 (раны 109-111, attachment_not_authorized):
    общая библиотека RAG отдаёт боту чанки файлов ДРУГИХ чатов — attachment
    найденного документа обязан поститься в целевой чат. Юзерский чужой
    файл без инжеста остаётся запрещённым."""
    from fastapi import HTTPException
    from app.models.document import Document
    from app.models.file import File

    with session_factory() as session:
        owner = create_user(session, 'owner@example.com')
        other = create_user(session, 'other@example.com')
        service = MessageService(session)
        chat = ChatService(session).create(owner.id, ChatCreate(title='AI-чат', is_ai=True))
        foreign = ChatService(session).create(other.id, ChatCreate(title='Чужой чат'))

        # библиотечный документ: файл чужого чата + строка documents
        library_file = File(
            chat_id=foreign.id,
            owner_id=other.id,
            object_key='library/doc.pdf',
            original_name='Заявление.pdf',
            content_type='application/pdf',
            size_bytes=10,
            status='ready',
        )
        session.add(library_file)
        session.flush()
        session.add(Document(file_id=library_file.id, chat_id=foreign.id, owner_id=other.id, status='ready'))
        session.commit()

        posted = service.create(chat.id, owner.id, MessageCreate(content='Ответ по заявлению', file_id=library_file.id))

        assert posted.file_id == library_file.id

        # юзерский файл чужого чата без инжеста — по-прежнему отказ
        plain_file = File(
            chat_id=foreign.id,
            owner_id=other.id,
            object_key='foreign/own.docx',
            original_name='Личное.docx',
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size_bytes=10,
            status='ready',
        )
        session.add(plain_file)
        session.commit()

        try:
            service.create(chat.id, owner.id, MessageCreate(content='?', file_id=plain_file.id))
            raise AssertionError('foreign non-library file must be rejected')
        except HTTPException as exc:
            assert exc.status_code == 400
            assert exc.detail == 'file_not_ready_for_message'
