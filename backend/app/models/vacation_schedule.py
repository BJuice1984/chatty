"""Vacation schedule snapshot persistence model."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VacationSchedule(Base):
    """One xlsx snapshot: replace-per-(year, source_name) on re-ingest."""

    __tablename__ = 'vacation_schedules'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
