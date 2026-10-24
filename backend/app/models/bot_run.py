"""Durable bot run model."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BotRun(Base):
    __tablename__ = 'bot_runs'
    __table_args__ = (
        UniqueConstraint('message_id', name='uq_bot_runs_message'),
        Index('ix_bot_runs_chat_status', 'chat_id', 'status'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey('chats.id', ondelete='CASCADE'), nullable=False, index=True)
    message_id: Mapped[int] = mapped_column(ForeignKey('messages.id', ondelete='CASCADE'), nullable=False)
    bot_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='RESTRICT'), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default='queued', nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response_message_id: Mapped[int | None] = mapped_column(ForeignKey('messages.id', ondelete='SET NULL'), nullable=True)
    attachment_file_id: Mapped[int | None] = mapped_column(ForeignKey('files.id', ondelete='SET NULL'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
