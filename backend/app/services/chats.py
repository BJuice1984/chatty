"""Chat lifecycle and server-side membership authorization."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.chat import Chat, ChatMember
from app.models.user import User
from app.repositories.chats import ChatRepository
from app.repositories.users import UserRepository
from app.schemas.chat import ChatCreate


class ChatService:
    def __init__(self, session: Session):
        self.session = session
        self.chats = ChatRepository(session)
        self.users = UserRepository(session)

    def create(self, owner_id: int, payload: ChatCreate) -> Chat:
        chat = self.chats.add(Chat(title=payload.title.strip(), owner_id=owner_id, is_ai=payload.is_ai))
        self.chats.add_member(ChatMember(chat_id=chat.id, user_id=owner_id))
        self.session.commit()
        self.session.refresh(chat)
        return chat

    def list_for_user(self, user_id: int) -> list[Chat]:
        return self.chats.list_for_user(user_id)

    def require_chat(self, chat_id: int) -> Chat:
        chat = self.chats.get_by_id(chat_id)
        if chat is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='chat_not_found')
        return chat

    def require_member(self, chat_id: int, user_id: int) -> Chat:
        chat = self.require_chat(chat_id)
        if not self.chats.is_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
        return chat

    def add_member(self, chat_id: int, requester_id: int, user_id: int) -> ChatMember:
        self.require_member(chat_id, requester_id)
        if self.users.get_by_id(user_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user_not_found')
        existing = self.chats.get_member(chat_id, user_id)
        if existing is not None:
            return existing
        member = ChatMember(chat_id=chat_id, user_id=user_id)
        try:
            self.chats.add_member(member)
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            existing = self.chats.get_member(chat_id, user_id)
            if existing is None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='member_conflict')
            member = existing
        self.session.refresh(member)
        return member
