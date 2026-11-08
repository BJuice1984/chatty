"""User's confirmed schedule name persistence model."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VacationName(Base):
    """The canonical schedule ФИО a user confirmed as their own.

    Survives schedule re-ingest by design: it references the canonical
    name string, not a snapshot row id (D-4/D-13).
    """

    __tablename__ = 'vacation_names'

    user_id: Mapped[int] = mapped_column(
        ForeignKey('users.id', ondelete='CASCADE'),
        primary_key=True,
    )
    schedule_name: Mapped[str] = mapped_column(String(120), nullable=False)
    confirmed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
