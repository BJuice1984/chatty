"""Deterministic message history and idempotency queries."""

from __future__ import annotations

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.orm import Session

from app.models.message import Message


class MessageRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, message_id: int) -> Message | None:
        return self.session.get(Message, message_id)

    def get_by_client_message_id(self, chat_id: int, user_id: int, client_message_id: str) -> Message | None:
        statement = select(Message).where(
            Message.chat_id == chat_id,
            Message.user_id == user_id,
            Message.client_message_id == client_message_id,
        )
        return self.session.scalar(statement)

    def list_before(
        self,
        chat_id: int,
        *,
        before: Message | None,
        limit: int,
    ) -> list[Message]:
        statement = select(Message).where(Message.chat_id == chat_id)
        if before is not None:
            statement = statement.where(
                or_(
                    Message.created_at < before.created_at,
                    and_(Message.created_at == before.created_at, Message.id < before.id),
                )
            )
        statement = statement.order_by(desc(Message.created_at), desc(Message.id)).limit(limit + 1)
        return list(self.session.scalars(statement))

    def add(self, message: Message) -> Message:
        self.session.add(message)
        self.session.flush()
        return message
