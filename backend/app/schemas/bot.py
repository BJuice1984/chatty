"""HTTP contracts for durable bot runs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, PositiveInt


class BotRunCreate(BaseModel):
    message_id: PositiveInt


class BotRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chat_id: int
    message_id: int
    bot_user_id: int | None
    status: str
    attempt: int
    error_kind: str | None
    response_message_id: int | None
    attachment_file_id: int | None
    created_at: datetime
    updated_at: datetime
