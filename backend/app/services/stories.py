"""Story feed service: creation, feed assembly and idempotent views."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.file import File
from app.models.story import Story
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
            return StoryResponse(
                **self._common_fields(story, owners[story.owner_id]),
                # свои истории владельцу всегда непросмотренные: кольцо
                # не гаснет от собственного просмотра (UX «You story»)
                viewed=story.owner_id != user_id and story.id in viewed_ids,
                is_own=story.owner_id == user_id,
            )

        mine = [story for story in active if story.owner_id == user_id]
        others = [story for story in active if story.owner_id != user_id]
        # чужие: непросмотренные выше просмотренных (внутри групп — свежесть);
        # свои всегда первыми и всегда непросмотренные для владельца
        others.sort(key=lambda story: story.id in viewed_ids)
        return [to_response(story) for story in [*mine, *others]]

    @staticmethod
    def _common_fields(story: Story, owner: User) -> dict[str, object]:
        """Владелец-зависимые поля ответа — единственное место сборки, чтобы
        лента и WS-фан-аут не разъехались."""

        login = owner.email.lower()
        return {
            'id': story.id,
            'owner_id': story.owner_id,
            'owner_display_name': login.split('@', 1)[0] or login,
            'owner_avatar_url': (
                f'{owner.avatar_file_id}/download'
                if owner.avatar_file_id is not None
                else None
            ),
            'image_url': f'{story.file_id}/download',
            'created_at': story.created_at,
        }

    def to_broadcast_response(self, story: Story, owner: User) -> StoryResponse:
        """Viewer-independent shape for the WS fan-out of a fresh story.

        Форма не пересчитывается per-viewer: одним кадром уезжает всем,
        включая автора (его другие вкладки получают кольцо сразу, а не
        рефетчем) — viewed/is_own константы False/False, а владельца
        опознаёт клиент по owner_id (StoriesController.applyStoryCreated).
        """

        return StoryResponse(
            **self._common_fields(story, owner),
            viewed=False,
            is_own=False,
        )

    def mark_viewed(self, story_id: int, user_id: int) -> None:
        """Idempotent view record; expired stories stay viewable by design."""

        if self.stories.get_by_id(story_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='story_not_found')
        self.stories.add_view_if_absent(story_id, user_id)
        self.session.commit()

    def delete(self, story_id: int, user_id: int, storage) -> None:
        """Owner-only story removal: story row, file row and the object."""

        story = self.stories.get_by_id(story_id)
        if story is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='story_not_found')
        if story.owner_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='story_owner_required')
        file = self.session.get(File, story.file_id)
        object_key = file.object_key if file is not None else None
        self.session.delete(story)
        if file is not None:
            self.session.delete(file)
        self.session.commit()
        if object_key is not None:
            try:
                storage.delete(object_key)
            except Exception as exc:  # строка удалена, объект остался — не роняем запрос
                print(f'story delete: object {object_key} left in storage: {exc}')
