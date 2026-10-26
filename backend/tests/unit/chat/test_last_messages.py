from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember
from app.models.message import Message
from app.models.user import User
from app.repositories.chats import ChatRepository
from app.services.chats import ChatService

BASE_TIME = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


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


def make_message(
    session: Session,
    chat: Chat,
    sender: User,
    content: str | None,
    created_at: datetime,
) -> Message:
    message = Message(chat_id=chat.id, user_id=sender.id, content=content, created_at=created_at)
    session.add(message)
    session.flush()
    return message


def test_last_messages_newest_wins_with_created_at_id_tiebreak(session_factory):
    with session_factory() as session:
        u1 = make_user(session, 'u1@example.com')
        chat = make_chat(session, u1)

        # created_at главнее id: позднее сообщение выигрывает, даже если
        # вставлено раньше и получило меньший id
        later = make_message(session, chat, u1, 'later', BASE_TIME + timedelta(minutes=2))
        earlier = make_message(session, chat, u1, 'earlier', BASE_TIME)
        assert later.id < earlier.id

        # равные created_at: тай-брейк по id DESC — старший id выигрывает
        tie_a = make_message(session, chat, u1, 'tie-a', BASE_TIME + timedelta(minutes=5))
        tie_b = make_message(session, chat, u1, None, BASE_TIME + timedelta(minutes=5))

        empty_chat = make_chat(session, u1)  # без сообщений — в результате отсутствует

        repo = ChatRepository(session)
        rows = {
            chat_id: (content, created_at)
            for chat_id, content, created_at in repo.last_messages_for_chats(
                [chat.id, empty_chat.id]
            )
        }

        assert set(rows) == {chat.id}
        content, created_at = rows[chat.id]
        assert content is None  # tie_b: больший id при равном created_at
        # SQLite-окружение возвращает naive-datetime (диалект не хранит tz)
        assert created_at == tie_b.created_at.replace(tzinfo=None)
        assert content != tie_a.content

        # файловое вложение без текста проходит как content is None,
        # форма собирается в единой точке сервиса (для GET /chats)
        briefs = ChatService(session).last_messages_for_chats([chat.id, empty_chat.id])
        assert set(briefs) == {chat.id}
        assert briefs[chat.id].content is None
        assert briefs[chat.id].time == tie_b.created_at.replace(tzinfo=None)

        # пустой список id — ни одного запроса и пустой результат
        assert repo.last_messages_for_chats([]) == []


def test_last_messages_single_query(session_factory):
    with session_factory() as session:
        u1 = make_user(session, 'u1@example.com')
        u2 = make_user(session, 'u2@example.com')
        chats = [make_chat(session, u1, u2) for _ in range(3)]
        moment = BASE_TIME
        for chat in chats:
            make_message(session, chat, u2, 'first', moment)
            make_message(session, chat, u1, 'second', moment + timedelta(seconds=1))
            moment += timedelta(minutes=1)

        repo = ChatRepository(session)

        # ровно один SELECT на вызов по всему списку чатов (прецедент
        # test_unread_counts: было бы N запросов при per-chat выборке)
        statements: list[str] = []

        def record(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(session.bind, 'before_cursor_execute', record)
        try:
            rows = repo.last_messages_for_chats([chat.id for chat in chats])
        finally:
            event.remove(session.bind, 'before_cursor_execute', record)

        assert len([s for s in statements if s.lstrip().upper().startswith('SELECT')]) == 1
        assert {chat_id: content for chat_id, content, _ in rows} == {
            chat.id: 'second' for chat in chats
        }
