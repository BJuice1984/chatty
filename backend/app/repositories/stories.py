"""Story and story-view persistence queries."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
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

    def find_view(self, story_id: int, user_id: int) -> StoryView | None:
        return self.session.get(StoryView, (story_id, user_id))

    def add_view(self, view: StoryView) -> StoryView:
        self.session.add(view)
        self.session.flush()
        return view

    def active_stories(self, *, ttl_hours: int, cap: int, now: datetime) -> list[Story]:
        """Active stories newest first: feed grouping by owner happens above."""

        statement = (
            select(Story)
            .where(Story.created_at >= now - timedelta(hours=ttl_hours))
            .order_by(Story.created_at.desc(), Story.id.desc())
            .limit(cap)
        )
        return list(self.session.scalars(statement))
