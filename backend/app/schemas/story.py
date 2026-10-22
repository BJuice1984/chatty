"""Story feed contracts."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class StoryResponse(BaseModel):
    id: int
    owner_id: int
    # email local part, the same rule as UserSearchItem
    owner_display_name: str
    owner_avatar_url: str | None
    # files-relative image path ("{file_id}/download")
    image_url: str
    created_at: datetime
    # resolved for the requesting viewer
    viewed: bool
