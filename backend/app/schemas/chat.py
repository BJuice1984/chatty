"""HTTP chat and membership contracts."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, PositiveInt


class ChatCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    is_ai: bool = False


class ChatMemberCreate(BaseModel):
    user_id: PositiveInt


class ChatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    owner_id: int
    is_ai: bool
    created_at: datetime
    # непрочитанные для запрашивающего: чужие сообщения новее последнего
    # прочитанного (0, если всё прочитано)
    unread_count: int = 0
    # аватар чата (свой или None); заполняется из Chat.avatar_url
    avatar_url: str | None = None


class ChatMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    chat_id: int
    user_id: int
    joined_at: datetime
