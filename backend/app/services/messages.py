"""Message persistence, authorization, pagination and idempotency."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.message import Message
from app.repositories.chats import ChatRepository
from app.repositories.files import FileRepository
from app.repositories.messages import MessageRepository
from app.schemas.message import MessageCreate


MAX_HISTORY_LIMIT = 100


class MessageService:
    def __init__(self, session: Session):
        self.session = session
        self.chats = ChatRepository(session)
        self.files = FileRepository(session)
        self.messages = MessageRepository(session)

    def create(self, chat_id: int, user_id: int, payload: MessageCreate) -> Message:
        self._require_member(chat_id, user_id)
        if payload.client_message_id:
            existing = self.messages.get_by_client_message_id(chat_id, user_id, payload.client_message_id)
            if existing is not None:
                return existing
        if payload.file_id is not None:
            file = self.files.get_by_id(payload.file_id)
            if file is None or file.chat_id != chat_id or file.status != 'ready':
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='file_not_ready_for_message')
        message = Message(
            chat_id=chat_id,
            user_id=user_id,
            content=payload.content.strip() if payload.content else None,
            file_id=payload.file_id,
            client_message_id=payload.client_message_id,
        )
        try:
            self.messages.add(message)
            self.session.commit()
            self.session.refresh(message)
            return message
        except IntegrityError:
            self.session.rollback()
            if payload.client_message_id:
                existing = self.messages.get_by_client_message_id(chat_id, user_id, payload.client_message_id)
                if existing is not None:
                    return existing
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='message_conflict')

    def history(
        self,
        chat_id: int,
        user_id: int,
        *,
        before_id: int | None,
        limit: int,
    ) -> tuple[list[Message], int | None]:
        self._require_member(chat_id, user_id)
        bounded_limit = min(max(limit, 1), MAX_HISTORY_LIMIT)
        before = None
        if before_id is not None:
            before = self.messages.get_by_id(before_id)
            if before is None or before.chat_id != chat_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='invalid_history_cursor')
        rows = self.messages.list_before(chat_id, before=before, limit=bounded_limit)
        has_more = len(rows) > bounded_limit
        page = rows[:bounded_limit]
        return page, page[-1].id if has_more and page else None

    def _require_member(self, chat_id: int, user_id: int) -> None:
        if self.chats.get_by_id(chat_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='chat_not_found')
        if not self.chats.is_member(chat_id, user_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='chat_membership_required')
