"""Private object-storage file contract."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file_id: int
    chat_id: int | None
    owner_id: int
    object_key: str
    original_name: str
    content_type: str
    size_bytes: int
    status: str
    created_at: datetime
    updated_at: datetime

def avatar_url(file_id: int | None) -> str | None:
    """Files-relative avatar path; None when no avatar is uploaded."""

    return f'{file_id}/download' if file_id is not None else None


class AvatarUploadResponse(FileResponse):
    """Chat/user avatar upload result: the stored file plus the avatar path."""

    avatar_url: str | None
