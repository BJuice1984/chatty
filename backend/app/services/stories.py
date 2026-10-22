"""Story feed service: creation, feed assembly and idempotent views."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.file import File
from app.models.story import Story, StoryView
from app.models.user import User
from app.repositories.stories import StoryRepository
from app.schemas.story import StoryResponse

# feed cap: a guard, not a pagination contract
FEED_CAP = 100


class StoryService:
    def __init__(self, session: Session, settings: Settings):
        self.session = session
        self.settings = settings
        self.stories = StoryRepository(session)

    def create(self, *, owner_id: int, file: File) -> Story:
        story = self.stories.add(Story(owner_id=owner_id, file_id=file.id))
        self.session.commit()
        return story

    def list_feed(self, user_id: int) -> list[StoryResponse]:
        now = datetime.now(UTC)
        active = self.stories.active_stories(
            ttl_hours=self.settings.story_ttl_hours,
            cap=FEED_CAP,
            now=now,
        )
        viewed_ids = self.stories.viewed_story_ids(user_id)
        owner_ids = {story.owner_id for story in active}
        owners = {
            user.id: user
            for user in self.session.query(User).filter(User.id.in_(owner_ids))
        } if owner_ids else {}

        def to_response(story: Story) -> StoryResponse:
            owner = owners[story.owner_id]
            login = owner.email.lower()
            return StoryResponse(
                id=story.id,
                owner_id=story.owner_id,
                owner_display_name=login.split('@', 1)[0] or login,
                owner_avatar_url=(
                    f'{owner.avatar_file_id}/download'
                    if owner.avatar_file_id is not None
                    else None
                ),
                image_url=f'{story.file_id}/download',
                created_at=story.created_at,
                viewed=story.id in viewed_ids,
            )

        mine = [story for story in active if story.owner_id == user_id]
        others = [story for story in active if story.owner_id != user_id]
        # active_stories returns newest first; each group keeps that order
        return [to_response(story) for story in [*mine, *others]]

    def mark_viewed(self, story_id: int, user_id: int) -> None:
        """Idempotent view record; expired stories stay viewable by design."""

        if self.stories.get_by_id(story_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='story_not_found')
        if self.stories.find_view(story_id, user_id) is None:
            self.stories.add_view(StoryView(story_id=story_id, user_id=user_id))
            self.session.commit()
