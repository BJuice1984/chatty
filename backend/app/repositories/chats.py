"""Chat and membership queries."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember
from app.models.chat_last_read import ChatLastRead
from app.models.message import Message
from app.models.user import User


class ChatRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, chat_id: int) -> Chat | None:
        return self.session.get(Chat, chat_id)

    def list_for_user(self, user_id: int) -> list[Chat]:
        statement = (
            select(Chat)
            .join(ChatMember, ChatMember.chat_id == Chat.id)
            .where(ChatMember.user_id == user_id)
            .order_by(Chat.created_at.asc(), Chat.id.asc())
        )
        return list(self.session.scalars(statement))

    def is_member(self, chat_id: int, user_id: int) -> bool:
        statement = select(ChatMember.chat_id).where(
            ChatMember.chat_id == chat_id,
            ChatMember.user_id == user_id,
        )
        return self.session.scalar(statement) is not None

    def get_member(self, chat_id: int, user_id: int) -> ChatMember | None:
        return self.session.get(ChatMember, (chat_id, user_id))

    def add(self, chat: Chat) -> Chat:
        self.session.add(chat)
        self.session.flush()
        return chat

    def delete(self, chat: Chat) -> None:
        """Удаляет чат; зависимые строки снимаются каскадами БД по FK-правилам."""

        self.session.delete(chat)
        self.session.flush()

    def add_member(self, member: ChatMember) -> ChatMember:
        self.session.add(member)
        self.session.flush()
        return member

    def unread_counts(self, user_id: int) -> dict[int, int]:
        """Чужие сообщения новее последнего прочитанного маркера по каждому чату
        пользователя; своих сообщений не считаем."""
        reads = {
            row.chat_id: row.last_read_message_id
            for row in self.session.query(ChatLastRead).filter(ChatLastRead.user_id == user_id).all()
        }
        counts: dict[int, int] = {}
        member_rows = (
            self.session.query(ChatMember.chat_id)
            .filter(ChatMember.user_id == user_id)
            .all()
        )
        chat_ids = [row.chat_id for row in member_rows]

        if not chat_ids:
            return counts

        rows = (
            self.session.query(Message.chat_id, func.count(Message.id))
            .filter(
                Message.chat_id.in_(chat_ids),
                Message.user_id != user_id,
                Message.id > 0,
            )
            .group_by(Message.chat_id)
            .all()
        )
        raw = {chat_id: count for chat_id, count in rows}

        for chat_id in chat_ids:
            marker = reads.get(chat_id, 0)
            if marker == 0:
                counts[chat_id] = raw.get(chat_id, 0)
                continue
            newer = (
                self.session.query(func.count(Message.id))
                .filter(
                    Message.chat_id == chat_id,
                    Message.user_id != user_id,
                    Message.id > marker,
                )
                .scalar()
            )
            counts[chat_id] = int(newer or 0)

        return counts

    def mark_read(self, chat_id: int, user_id: int, message_id: int) -> None:
        """Upsert маркера чтения: двигаем только вперёд (старые страницы
        истории не «прочитывают» новее уже увиденного)."""
        existing = (
            self.session.query(ChatLastRead)
            .filter(ChatLastRead.user_id == user_id, ChatLastRead.chat_id == chat_id)
            .one_or_none()
        )

        if existing is None:
            self.session.add(
                ChatLastRead(user_id=user_id, chat_id=chat_id, last_read_message_id=message_id)
            )
        elif message_id > existing.last_read_message_id:
            existing.last_read_message_id = message_id

        self.session.commit()

    def list_members(self, chat_id: int) -> list[tuple[int, str]]:
        """Участники чата как (user_id, email-хэнл) — для UI-списка и меток
        «уже добавлен» в поиске пользователей."""
        rows = (
            self.session.query(ChatMember.user_id, User.email)
            .join(User, User.id == ChatMember.user_id)
            .filter(ChatMember.chat_id == chat_id)
            .order_by(ChatMember.user_id)
            .all()
        )
        return [(row.user_id, row.email) for row in rows]
