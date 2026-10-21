"""Reaction persistence queries: точечный доступ и агрегаты для сводок."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.reaction import Reaction


class ReactionRepository:
    def __init__(self, session: Session):
        self.session = session

    def find(self, message_id: int, user_id: int, emoji: str) -> Reaction | None:
        statement = select(Reaction).where(
            Reaction.message_id == message_id,
            Reaction.user_id == user_id,
            Reaction.emoji == emoji,
        )
        return self.session.scalar(statement)

    def add(self, reaction: Reaction) -> Reaction:
        self.session.add(reaction)
        self.session.flush()
        return reaction

    def remove(self, reaction: Reaction) -> None:
        self.session.delete(reaction)
        self.session.flush()

    def counts_by_message(self, message_ids: Sequence[int]) -> list[tuple[int, str, int]]:
        """Счётчики (message_id, emoji, count) по набору сообщений, стабильно отсортированные по emoji."""

        if not message_ids:
            return []
        statement = (
            select(Reaction.message_id, Reaction.emoji, func.count())
            .where(Reaction.message_id.in_(message_ids))
            .group_by(Reaction.message_id, Reaction.emoji)
            .order_by(Reaction.message_id.asc(), Reaction.emoji.asc())
        )
        return [tuple(row) for row in self.session.execute(statement)]

    def viewer_emojis(self, message_ids: Sequence[int], viewer_id: int) -> set[tuple[int, str]]:
        """Пары (message_id, emoji), уже поставленные зрителем, — основа флага ``mine``."""

        if not message_ids:
            return set()
        statement = select(Reaction.message_id, Reaction.emoji).where(
            Reaction.message_id.in_(message_ids),
            Reaction.user_id == viewer_id,
        )
        return set(self.session.execute(statement))
