"""Per-user assistant dialog state persistence model."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AssistantDialogState(Base):
    """Vacation-skill dialog state keyed by user (runs are stateless).

    TTL lives in the reader (VacationStore): a state older than
    CHATTY_VACATION_DIALOG_TTL_SECONDS behaves as absent (D-5).
    """

    __tablename__ = 'assistant_dialog_state'

    user_id: Mapped[int] = mapped_column(
        ForeignKey('users.id', ondelete='CASCADE'),
        primary_key=True,
    )
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    origin_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON blob for the forms wizards (migration 016, D-F-11): chosen
    # form kind, period and the collected dates.
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default='0', nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        nullable=False,
    )
