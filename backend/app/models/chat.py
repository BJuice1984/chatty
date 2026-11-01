"""Chat and membership persistence models."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Chat(Base):
    __tablename__ = 'chats'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='RESTRICT'), nullable=False, index=True)
    is_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default='0', nullable=False)
    # DM marker: a 1:1 chat is defined ONLY by this flag (never by member
    # counting), so a plain 2-member group is never promoted implicitly
    is_dm: Mapped[bool] = mapped_column(Boolean, default=False, server_default='0', nullable=False)
    # use_alter: files<->chats/users FK-цикл, drop_all без него не сортирует таблицы
    avatar_file_id: Mapped[int | None] = mapped_column(
        ForeignKey('files.id', ondelete='SET NULL', use_alter=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )

    @property
    def avatar_url(self) -> str | None:
        """Avatar as a files-relative path for from_attributes responses."""

        return f'{self.avatar_file_id}/download' if self.avatar_file_id is not None else None


class ChatMember(Base):
    __tablename__ = 'chat_members'

    chat_id: Mapped[int] = mapped_column(ForeignKey('chats.id', ondelete='CASCADE'), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
