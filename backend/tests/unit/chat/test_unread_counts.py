from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember
from app.models.chat_last_read import ChatLastRead
from app.models.message import Message
from app.models.user import User
from app.repositories.chats import ChatRepository


def make_user(session: Session, email: str) -> User:
    user = User(email=email, password_hash='x' * 60)
    session.add(user)
    session.flush()
    return user


def make_chat(session: Session, *members: User) -> Chat:
    chat = Chat(title=f'chat-{members[0].id}-{members[-1].id}', owner_id=members[0].id)
    session.add(chat)
    session.flush()
    for member in members:
        session.add(ChatMember(chat_id=chat.id, user_id=member.id))
    session.flush()
    return chat


def make_message(session: Session, chat: Chat, sender: User, content: str) -> Message:
    message = Message(chat_id=chat.id, user_id=sender.id, content=content)
    session.add(message)
    session.flush()
    return message


def test_unread_counts_semantics_and_single_query(session_factory):
    with session_factory() as session:
        u1 = make_user(session, 'u1@example.com')
        u2 = make_user(session, 'u2@example.com')
        u3 = make_user(session, 'u3@example.com')

        chat_a = make_chat(session, u1, u2)
        chat_b = make_chat(session, u1, u3)
        chat_c = make_chat(session, u1)  # пустой чат — в результате с нулём
        chat_u23 = make_chat(session, u2, u3)  # чат без u1 — в его результате отсутствует

        m1 = make_message(session, chat_a, u2, 'm1')
        make_message(session, chat_a, u1, 'm2')  # своё — не считается
        m3 = make_message(session, chat_a, u2, 'm3')
        make_message(session, chat_b, u3, 'm4')

        repo = ChatRepository(session)

        # без маркеров: все чужие по каждому чату участника
        assert repo.unread_counts(u1.id) == {chat_a.id: 2, chat_b.id: 1, chat_c.id: 0}
        assert repo.unread_counts(u2.id) == {chat_a.id: 1, chat_u23.id: 0}
        assert chat_u23.id not in repo.unread_counts(u1.id)

        session.add(ChatLastRead(user_id=u1.id, chat_id=chat_a.id, last_read_message_id=m1.id))
        session.commit()

        # маркер по m1: в A остаётся только чужое новее маркера (m3)
        assert repo.unread_counts(u1.id) == {chat_a.id: 1, chat_b.id: 1, chat_c.id: 0}

        marker = session.query(ChatLastRead).filter_by(user_id=u1.id, chat_id=chat_a.id).one()
        marker.last_read_message_id = m3.id
        session.commit()

        assert repo.unread_counts(u1.id) == {chat_a.id: 0, chat_b.id: 1, chat_c.id: 0}

        # консолидация: ровно один SELECT на вызов (было 3 + COUNT на чат)
        statements: list[str] = []

        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(session.bind, 'before_cursor_execute', record)
        try:
            repo.unread_counts(u1.id)
        finally:
            event.remove(session.bind, 'before_cursor_execute', record)

        assert len([s for s in statements if s.lstrip().upper().startswith('SELECT')]) == 1


def test_mark_read_upsert_is_forward_only_and_race_safe(session_factory):
    with session_factory() as session:
        u1, u2 = make_user(session, 'u1@example.com'), make_user(session, 'u2@example.com')
        chat = make_chat(session, u1, u2)
        m1 = make_message(session, chat, u2, 'm1')
        m2 = make_message(session, chat, u2, 'm2')

        repo = ChatRepository(session)

        def marker() -> int:
            row = session.query(ChatLastRead).filter_by(user_id=u1.id, chat_id=chat.id).one()
            return row.last_read_message_id

        # строки ещё нет — маркер создаётся; конкурентный повтор (строка уже
        # есть, гонка проиграна) гасится ON CONFLICT, а не IntegrityError
        repo.mark_read(chat.id, u1.id, m1.id)
        repo.mark_read(chat.id, u1.id, m1.id)
        assert marker() == m1.id

        # назад не двигается: старые страницы истории не перетирают маркер
        repo.mark_read(chat.id, u1.id, m1.id - 1)
        assert marker() == m1.id

        # вперёд двигается
        repo.mark_read(chat.id, u1.id, m2.id)
        assert marker() == m2.id
