"""Chat last-read marker powering the unread counter."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ChatLastRead(Base):
    """Последнее прочитанное сообщение пользователя в чате."""

    __tablename__ = 'chat_last_reads'
    __table_args__ = (UniqueConstraint('user_id', 'chat_id', name='uq_chat_last_reads_user_chat'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    chat_id: Mapped[int] = mapped_column(ForeignKey('chats.id', ondelete='CASCADE'), nullable=False)
    last_read_message_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
