"""Chat and membership queries."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember


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

    def add_member(self, member: ChatMember) -> ChatMember:
        self.session.add(member)
        self.session.flush()
        return member
