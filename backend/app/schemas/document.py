"""Document ingestion and chat-scoped retrieval contracts."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_id: int
    chat_id: int
    owner_id: int
    status: str
    error_kind: str | None
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class DocumentSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1)


class DocumentChunkResponse(BaseModel):
    document_id: int
    file_id: int
    ordinal: int
    content: str
    score: float
