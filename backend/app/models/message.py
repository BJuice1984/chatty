"""Durable chat message model."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Message(Base):
    __tablename__ = 'messages'
    __table_args__ = (
        UniqueConstraint('chat_id', 'user_id', 'client_message_id', name='uq_messages_sender_client_id'),
        Index('ix_messages_chat_created_id', 'chat_id', 'created_at', 'id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey('chats.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_id: Mapped[int | None] = mapped_column(ForeignKey('files.id', ondelete='SET NULL'), nullable=True, index=True)
    client_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
