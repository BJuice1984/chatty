"""HTTP and WebSocket message contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, PositiveInt, model_validator

from app.schemas.reaction import ReactionSummary


class MessageCreate(BaseModel):
    content: str | None = Field(default=None, max_length=20_000)
    file_id: PositiveInt | None = None
    client_message_id: str | None = Field(default=None, min_length=1, max_length=128)
    reply_to_id: PositiveInt | None = None

    @model_validator(mode='after')
    def require_content_or_file(self) -> 'MessageCreate':
        if not (self.content and self.content.strip()) and self.file_id is None:
            raise ValueError('content_or_file_required')
        return self


class MessageReplyTo(BaseModel):
    """Цитируемое сообщение: кто сказал и укороченный текст (снимок сервера)."""

    id: int
    user_id: int
    snippet: str


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    user_id: int
    content: str | None
    file_id: int | None
    client_message_id: str | None
    reply_to_id: int | None = None
    reply_to: MessageReplyTo | None = None
    reactions: list[ReactionSummary] = Field(default_factory=list)
    created_at: datetime


class MessagePage(BaseModel):
    messages: list[MessageResponse]
    before_id: int | None = None
    limit: int
    next_before_id: int | None = None


class WebSocketEvent(BaseModel):
    type: str
    content: Any


class WebSocketMessageContent(BaseModel):
    content: str | None = Field(default=None, max_length=20_000)
    file_id: PositiveInt | None = None
    client_message_id: str | None = Field(default=None, min_length=1, max_length=128)
    reply_to_id: PositiveInt | None = None

    @model_validator(mode='after')
    def require_content_or_file(self) -> 'WebSocketMessageContent':
        if not (self.content and self.content.strip()) and self.file_id is None:
            raise ValueError('content_or_file_required')
        return self


class WebSocketHistoryContent(BaseModel):
    before_id: PositiveInt | None = None
    limit: int = Field(default=50, ge=1, le=100)
