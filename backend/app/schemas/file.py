"""Private object-storage file contract."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file_id: int
    chat_id: int
    owner_id: int
    object_key: str
    original_name: str
    content_type: str
    size_bytes: int
    status: str
    created_at: datetime
    updated_at: datetime
