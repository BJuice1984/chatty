"""Story and story-view persistence queries."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.story import Story, StoryView


class StoryRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, story: Story) -> Story:
        self.session.add(story)
        self.session.flush()
        return story

    def get_by_id(self, story_id: int) -> Story | None:
        return self.session.get(Story, story_id)

    def viewed_story_ids(self, user_id: int) -> set[int]:
        statement = select(StoryView.story_id).where(StoryView.user_id == user_id)
        return set(self.session.scalars(statement))

    def add_view_if_absent(self, story_id: int, user_id: int) -> None:
        """Вставка просмотра без check-then-insert гонки: конфликт
        композитного PK (story_id, user_id) гасится на стороне БД. Диалект
        INSERT ... ON CONFLICT выбирается по bind-у сессии — юниты идут на
        SQLite, прод на PostgreSQL."""

        insert = pg_insert if self.session.get_bind().dialect.name == 'postgresql' else sqlite_insert
        self.session.execute(
            insert(StoryView).values(story_id=story_id, user_id=user_id).on_conflict_do_nothing()
        )

    def active_stories(self, *, ttl_hours: int, cap: int, now: datetime) -> list[Story]:
        """Active stories newest first: feed grouping by owner happens above."""

        statement = (
            select(Story)
            .where(Story.created_at >= now - timedelta(hours=ttl_hours))
            .order_by(Story.created_at.desc(), Story.id.desc())
            .limit(cap)
        )
        return list(self.session.scalars(statement))
