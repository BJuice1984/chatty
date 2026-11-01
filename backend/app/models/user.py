"""User persistence model."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default='user', nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Editable profile fields: display_name NULL falls back to the email
    # local part at every response boundary (search, contacts, member briefs)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Privacy toggle: when false, the viewer's own history loads stop
    # advancing their last-read marker (chat_last_reads has no peer
    # consumer — sender-visible receipts are a non-goal)
    send_read_receipts: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default='1',
        nullable=False,
    )
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
