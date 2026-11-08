"""Vacation period row persistence model."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Date, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VacationPeriod(Base):
    """A dated period of one person inside a schedule snapshot."""

    __tablename__ = 'vacation_periods'
    __table_args__ = (
        Index('ix_vacation_periods_schedule_full_name', 'schedule_id', 'full_name'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey('vacation_schedules.id', ondelete='CASCADE'),
        nullable=False,
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    position: Mapped[str | None] = mapped_column(String(120), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    days: Mapped[int] = mapped_column(Integer, nullable=False)
